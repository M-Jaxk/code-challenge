import { getBalance, setBalance } from '../shared/balances-store.js';
import { formatAmount } from './format.js';
import { fetchTokenPrices } from './price-service.js';
import { createTokenPicker } from './token-picker.js';
import { getSwapFormElements, getSwapQuote, renderSwap } from './swap-form.js';

const $ = (selector) => document.querySelector(selector);
const REFRESH_MS = 5 * 60 * 1000;

export function initializeSwap() {
  const state = {
    tokens: [],
    selected: { pay: 'USDC', receive: 'ETH' },
    loading: false,
    refreshTimer: null,
  };
  const { payInput, submitButton } = getSwapFormElements();
  const tokenPicker = createTokenPicker({
    getTokens: () => state.tokens,
    getSelected: () => state.selected,
    onSelect: (side, symbol) => {
      state.selected[side] = symbol;
      renderSwap(state);
    },
  });

  let toastTimer;
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
  }

  async function refreshPrices() {
    const status = $('#feed-status');
    if (!state.tokens.length) status.textContent = 'Connecting to market data';
    try {
      const { tokens, snapshotDate } = await fetchTokenPrices();
      state.tokens = tokens;
      status.textContent = `Price data snapshot · ${snapshotDate}`;
      $('#rate-source').textContent = 'Switcheo price feed';

      if (!tokens.some((token) => token.currency === state.selected.pay)) {
        state.selected.pay = tokens[0].currency;
      }
      if (!tokens.some((token) => token.currency === state.selected.receive) || state.selected.receive === state.selected.pay) {
        state.selected.receive = tokens.find((token) => token.currency !== state.selected.pay)?.currency ?? state.selected.pay;
      }
      renderSwap(state);
    } catch (error) {
      console.error('Unable to load token prices:', error);
      status.textContent = 'Market data unavailable';
      $('#exchange-rate').textContent = 'Unable to load rates';
      showToast('Could not load token prices. Check your connection and retry.');
    } finally {
      window.clearTimeout(state.refreshTimer);
      state.refreshTimer = window.setTimeout(refreshPrices, REFRESH_MS);
    }
  }

  async function submitSwap(event) {
    event.preventDefault();
    renderSwap(state);
    if (submitButton.disabled) return;

    const quote = getSwapQuote(state);
    if (!quote) return;
    state.loading = true;
    renderSwap(state);
    await new Promise((resolve) => window.setTimeout(resolve, 1050));

    setBalance(quote.paySymbol, getBalance(quote.paySymbol) - quote.payAmount);
    setBalance(quote.receiveSymbol, getBalance(quote.receiveSymbol) + quote.receiveAmount);
    $('#result-copy').textContent = `You swapped ${formatAmount(quote.payAmount)} ${quote.paySymbol} for ${formatAmount(quote.receiveAmount)} ${quote.receiveSymbol}. This was a demo only; no assets moved.`;
    $('#result-dialog').showModal();
    payInput.value = '';
    state.loading = false;
    renderSwap(state);
  }

  payInput.addEventListener('input', () => renderSwap(state));
  document.querySelectorAll('.token-select').forEach((button) => {
    button.addEventListener('click', () => tokenPicker.open(button.dataset.side));
  });
  $('#flip-button').addEventListener('click', () => {
    [state.selected.pay, state.selected.receive] = [state.selected.receive, state.selected.pay];
    renderSwap(state);
  });
  $('#max-button').addEventListener('click', () => {
    payInput.value = String(getBalance(state.selected.pay));
    renderSwap(state);
    payInput.focus();
  });
  $('#wallet-button').addEventListener('click', () => showToast('Wallet connection is simulated in this demo.'));
  $('#settings-button').addEventListener('click', () => showToast('Indicative quotes use the latest available price in the supplied feed.'));
  $('#swap-form').addEventListener('submit', submitSwap);
  $('#result-close').addEventListener('click', () => $('#result-dialog').close());
  $('#result-dialog').addEventListener('click', (event) => {
    if (event.target === $('#result-dialog')) $('#result-dialog').close();
  });

  renderSwap(state);
  void refreshPrices();
}
