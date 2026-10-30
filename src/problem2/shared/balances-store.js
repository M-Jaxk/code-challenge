const STORAGE_KEY = 'orbit-demo-balances-v1';

export const INITIAL_BALANCES = Object.freeze({
  USDC: 2480.5,
  USD: 900,
  ETH: 1.24,
  BTC: 0.08,
  OSMO: 850,
  ATOM: 44,
  SWTH: 22000,
  BUSD: 1200,
  USDT: 540,
});

export function getBalances() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const balances = { ...INITIAL_BALANCES };
    for (const [symbol, amount] of Object.entries(stored)) {
      if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
        balances[symbol] = amount;
      }
    }
    return balances;
  } catch {
    return { ...INITIAL_BALANCES };
  }
}

export function getBalance(symbol) {
  return getBalances()[symbol] ?? 0;
}

export function setBalance(symbol, amount) {
  const balances = getBalances();
  balances[symbol] = Math.max(0, amount);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(balances));
}
