export const PRICE_URL = 'https://interview.switcheo.com/prices.json';

function latestPricesByCurrency(records) {
  const latest = new Map();
  for (const record of records) {
    if (typeof record?.currency !== 'string' || !Number.isFinite(record.price) || record.price <= 0) continue;
    const previous = latest.get(record.currency);
    const date = Date.parse(record.date) || 0;
    const previousDate = previous ? Date.parse(previous.date) || 0 : -1;
    if (!previous || date >= previousDate) latest.set(record.currency, record);
  }
  return [...latest.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export async function fetchTokenPrices() {
  const response = await fetch(PRICE_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Price feed returned ${response.status}`);
  const records = await response.json();
  if (!Array.isArray(records)) throw new Error('Unexpected price feed format');

  const tokens = latestPricesByCurrency(records);
  if (!tokens.length) throw new Error('No usable token prices found');
  const latestTimestamp = Math.max(...tokens.map((token) => Date.parse(token.date) || 0));
  const snapshotDate = latestTimestamp
    ? new Date(latestTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'unknown date';

  return { tokens, snapshotDate };
}
