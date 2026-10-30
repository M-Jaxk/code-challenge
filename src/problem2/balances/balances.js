import { getBalances } from '../shared/balances-store.js';

const PRICE_URL = 'https://interview.switcheo.com/prices.json';
const ICON_ROOT = 'https://raw.githubusercontent.com/Switcheo/token-icons/main/tokens/';
const $ = (selector) => document.querySelector(selector);
const list = $('#holdings-list');
const filter = $('#holding-filter');
const emptyMessage = $('#empty-holdings');
let prices = new Map();

function formatAmount(amount) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(amount);
}

function formatUsd(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount >= 1000 ? 2 : 4,
  }).format(amount);
}

function renderHoldings(query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  const balances = getBalances();
  const holdings = Object.entries(balances)
    .filter(([symbol, amount]) => amount > 0 && symbol.toLowerCase().includes(normalizedQuery))
    .sort(([symbolA], [symbolB]) => symbolA.localeCompare(symbolB));

  list.replaceChildren();
  emptyMessage.hidden = holdings.length !== 0;

  for (const [symbol, amount] of holdings) {
    const price = prices.get(symbol);
    const row = document.createElement('article');
    row.className = 'holding-row';

    const identity = document.createElement('div');
    identity.className = 'holding-identity';
    const icon = document.createElement('img');
    icon.className = 'holding-icon';
    icon.alt = '';
    icon.src = `${ICON_ROOT}${encodeURIComponent(symbol)}.svg`;
    icon.onerror = () => {
      icon.onerror = null;
      const fallbackIcon = document.createElement('span');
      fallbackIcon.className = 'holding-icon icon-missing';
      fallbackIcon.textContent = symbol.slice(0, 1);
      fallbackIcon.setAttribute('aria-hidden', 'true');
      icon.replaceWith(fallbackIcon);
    };
    const tokenText = document.createElement('div');
    tokenText.className = 'holding-token-text';
    const tokenName = document.createElement('strong');
    tokenName.textContent = symbol;
    const priceLabel = document.createElement('span');
    priceLabel.textContent = price ? `${formatUsd(price)} per token` : 'Price unavailable';
    tokenText.append(tokenName, priceLabel);
    identity.append(icon, tokenText);

    const values = document.createElement('div');
    values.className = 'holding-values';
    const quantity = document.createElement('strong');
    quantity.textContent = `${formatAmount(amount)} ${symbol}`;
    const total = document.createElement('span');
    total.textContent = price ? formatUsd(amount * price) : '—';
    values.append(quantity, total);
    row.append(identity, values);
    list.append(row);
  }
}

async function loadPrices() {
  try {
    const response = await fetch(PRICE_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Price request failed (${response.status})`);
    const records = await response.json();
    if (!Array.isArray(records)) throw new Error('Unexpected price feed format');

    const newest = new Map();
    for (const record of records) {
      if (typeof record?.currency !== 'string' || !Number.isFinite(record.price) || record.price <= 0) continue;
      const prior = newest.get(record.currency);
      const date = Date.parse(record.date) || 0;
      if (!prior || date >= (Date.parse(prior.date) || 0)) newest.set(record.currency, record);
    }
    prices = new Map([...newest].map(([symbol, record]) => [symbol, record.price]));

    const mostRecent = Math.max(...[...newest.values()].map((record) => Date.parse(record.date) || 0));
    const snapshot = mostRecent
      ? new Date(mostRecent).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'date unavailable';
    $('#balance-status').textContent = `Price data snapshot · ${snapshot}`;
  } catch (error) {
    console.error('Unable to load portfolio prices:', error);
    $('#balance-status').textContent = 'Prices unavailable · token amounts are still shown';
  }

  renderHoldings(filter.value);
  const totalValue = Object.entries(getBalances()).reduce((sum, [symbol, amount]) => {
    const price = prices.get(symbol);
    return sum + (price ? amount * price : 0);
  }, 0);
  $('#portfolio-title').textContent = formatUsd(totalValue);
  $('#portfolio-caption').textContent = prices.size
    ? 'Estimated total across tokens with a listed price'
    : 'Total value unavailable until market data loads';
}

filter.addEventListener('input', () => renderHoldings(filter.value));
window.addEventListener('storage', () => {
  renderHoldings(filter.value);
  loadPrices();
});
$('#wallet-button').addEventListener('click', () => {
  const toast = $('#toast');
  toast.textContent = 'Wallet connection is simulated in this demo.';
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 3000);
});

renderHoldings();
loadPrices();
