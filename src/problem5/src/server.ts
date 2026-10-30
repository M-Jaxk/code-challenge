import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import type { Server } from 'node:http';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { database, initializeDatabase } from './database.js';

/**
 * Public API representation of a resource.
 * Timestamps are returned as ISO 8601 strings.
 */
interface Resource {
  id: number;
  name: string;
  description: string;
  category: string;
  created_at: string;
  updated_at: string;
}

/**
 * Shape returned by PostgreSQL for resource queries.
 */
interface ResourceRow {
  id: number;
  name: string;
  description: string;
  category: string;
  created_at: Date;
  updated_at: Date;
}

type ResourceFields = Pick<Resource, 'name' | 'description' | 'category'>;

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const FIELD_LIMITS = {
  name: 200,
  description: 5000,
  category: 100,
} as const;

type FieldName = keyof typeof FIELD_LIMITS;

export const app = express();
const port = parseInteger(process.env.PORT, 3000, 1, 65535);
if (port === null) {
  console.error('PORT must be an integer between 1 and 65535');
  process.exit(1);
}
const socketPort = parseInteger(process.env.PGLITE_SOCKET_PORT, 0, 1, 65535);
if (socketPort === null) {
  console.error('PGLITE_SOCKET_PORT must be an integer between 1 and 65535');
  process.exit(1);
}
let socketServer: PGLiteSocketServer | undefined;
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

/**
 * Parses a positive integer route parameter.
 *
 */
function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Parses an optional integer from an environment variable or query string.
 */
function parseInteger(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/**
 * Type guard for plain JSON objects, excluding `null` and arrays.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates and trims a required text field.
 */
function readRequiredString(value: unknown, field: FieldName): ParseResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: `${field} must be a non-empty string` };
  }
  if (value.length > FIELD_LIMITS[field]) {
    return { ok: false, error: `${field} must be at most ${FIELD_LIMITS[field]} characters` };
  }
  return { ok: true, value: value.trim() };
}

/**
 * Validates and trims an optional text field.
 */
function readOptionalString(value: unknown, field: FieldName): ParseResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` };
  if (value.length > FIELD_LIMITS[field]) {
    return { ok: false, error: `${field} must be at most ${FIELD_LIMITS[field]} characters` };
  }
  return { ok: true, value: value.trim() };
}

/**
 * Validates and normalises the payload for creating a resource.
 *
 * Task requirement 1.1: create a resource. `name` is required, while
 * `description` and `category` default to empty strings.
 */
function parseCreateInput(body: unknown): ParseResult<ResourceFields> {
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' };

  const name = readRequiredString(body.name, 'name');
  if (!name.ok) return name;
  const description = readOptionalString(body.description, 'description');
  if (!description.ok) return description;
  const category = readOptionalString(body.category, 'category');
  if (!category.ok) return category;

  return {
    ok: true,
    value: {
      name: name.value,
      description: description.value ?? '',
      category: category.value ?? '',
    },
  };
}

/**
 * Validates and normalises a partial resource update.
 *
 * Task requirement 1.4: update resource details. At least one of `name`,
 * `description`, or `category` must be provided.
 */
function parseUpdateInput(body: unknown): ParseResult<Partial<ResourceFields>> {
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' };

  const update: Partial<ResourceFields> = {};
  if (body.name !== undefined) {
    const name = readRequiredString(body.name, 'name');
    if (!name.ok) return name;
    update.name = name.value;
  }
  for (const field of ['description', 'category'] as const) {
    if (body[field] === undefined) continue;
    const parsed = readOptionalString(body[field], field);
    if (!parsed.ok) return parsed;
    update[field] = parsed.value ?? '';
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: 'Provide at least one field to update' };
  }
  return { ok: true, value: update };
}

/**
 * Escapes SQL `LIKE` wildcard characters so filters match literal text.
 */
function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

/**
 * Maps a PostgreSQL row to the public resource shape.
 */
function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Looks up a resource by ID and sends a JSON `404` response when it is missing.
 *
 * shared resource lookup used by the get and
 * update handlers.
 */
async function findResource(id: number, res: Response): Promise<Resource | null> {
  const { rows } = await database.query<ResourceRow>(
    'SELECT * FROM resources WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: 'Resource not found' });
    return null;
  }
  return toResource(row);
}

/**
 * Health check used to verify that the API process is running.
 */
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

/**
 * Task requirement 1.1: create a resource.
 * Validates the payload, inserts a row, and returns the created resource with `201`.
 */
app.post('/api/resources', async (req: Request<{}, {}, unknown>, res: Response) => {
  const parsed = parseCreateInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const { name, description, category } = parsed.value;
  const { rows } = await database.query<ResourceRow>(
    `INSERT INTO resources (name, description, category)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, description, category],
  );
  return res.status(201).json(toResource(rows[0]));
});

/**
 * list resources with basic filters.
 * Supports `name` substring and exact `category` filters, plus `limit`/`offset`.
 */
app.get('/api/resources', async (req, res) => {
  const limit = parseInteger(req.query.limit, 50, 1, 100);
  if (limit === null) return res.status(400).json({ error: 'limit must be an integer between 1 and 100' });
  const offset = parseInteger(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (offset === null) return res.status(400).json({ error: 'offset must be a non-negative integer' });

  const conditions: string[] = [];
  const filterValues: string[] = [];
  if (typeof req.query.name === 'string' && req.query.name.trim()) {
    filterValues.push(`%${escapeLike(req.query.name.trim())}%`);
    conditions.push(`name ILIKE $${filterValues.length} ESCAPE '!'`);
  }
  if (typeof req.query.category === 'string' && req.query.category.trim()) {
    filterValues.push(req.query.category.trim());
    conditions.push(`category = $${filterValues.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await database.query<ResourceRow>(
    `SELECT * FROM resources ${where} ORDER BY id DESC LIMIT $${filterValues.length + 1} OFFSET $${filterValues.length + 2}`,
    [...filterValues, limit, offset],
  );
  return res.json({ data: rows.map(toResource), limit, offset });
});

/**
 * Get details of a resource.
 * Returns the resource with `200`, or a JSON error with `400`/`404`.
 */
app.get('/api/resources/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const resource = await findResource(id, res);
  if (!resource) return;
  return res.json(resource);
});

/**
 * Update resource details.
 * Applies a partial update to `name`, `description`, and/or `category`.
 */
app.patch('/api/resources/:id', async (req: Request<{ id: string }, {}, unknown>, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const current = await findResource(id, res);
  if (!current) return;
  const parsed = parseUpdateInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const next = { ...current, ...parsed.value };
  const { rows } = await database.query<ResourceRow>(
    `UPDATE resources
     SET name = $1, description = $2, category = $3, updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [next.name, next.description, next.category, id],
  );
  const updated = rows[0];
  if (!updated) return res.status(404).json({ error: 'Resource not found' });
  return res.json(toResource(updated));
});

/**
 * Delete a resource.
 * Returns `204` on success and `404` when the resource does not exist.
 */
app.delete('/api/resources/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const result = await database.query('DELETE FROM resources WHERE id = $1', [id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Resource not found' });
  return res.status(204).end();
});

/**
 * Fallback handler for unknown routes.
 */
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

/**
 * Central error handler for malformed JSON, oversized bodies, and unexpected errors.
 */
const handleError: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const { type } = error as { type?: string };
  if (type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  console.error(error);
  return res.status(500).json({ error: 'Internal server error' });
};
app.use(handleError);

/**
 * Stops accepting requests, closes the optional PGlite socket server and
 * database, then exits.
 */
function shutdown(server: Server, signal: NodeJS.Signals): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void (async () => {
      try {
        await socketServer?.stop();
      } catch (error) {
        console.error('Failed to stop the PGlite socket server', error);
      }
      try {
        await database.close();
      } catch (error) {
        console.error('Failed to close the PGlite database', error);
      }
      process.exit(0);
    })();
  });
}

/**
 * Initialises the database schema, opens the optional TablePlus-compatible
 * socket, and starts the HTTP server.
 */
async function start(): Promise<void> {
  await initializeDatabase();

  if (socketPort !== null && socketPort !== 0) {
    socketServer = new PGLiteSocketServer({
      db: database,
      host: '127.0.0.1',
      port: socketPort,
      maxConnections: 5,
    });
    await socketServer.start();
    console.log(`PGlite PostgreSQL socket listening at 127.0.0.1:${socketPort}`);
  }

  const server = app.listen(port, () => console.log(`Resource API listening at http://localhost:${port}`));
  server.on('error', (error) => {
    console.error('HTTP server error', error);
    process.exit(1);
  });
  process.on('SIGINT', () => shutdown(server, 'SIGINT'));
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  void start().catch((error: unknown) => {
    console.error('Failed to start Resource API', error);
    process.exit(1);
  });
}
