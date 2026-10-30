import { getBalance } from '../shared/balances-store.js';
import { formatAmount, formatUsd } from './format.js';

const ICON_ROOT = 'https://raw.githubusercontent.com/Switcheo/token-icons/main/tokens/';
const $ = (selector) => document.querySelector(selector);
const payInput = $('#pay-amount');
const receiveInput = $('#receive-amount');
const errorBox = $('#form-error');
const submitButton = $('#submit-button');

export function parseAmount(value) {
  const normalized = value.trim().replaceAll(',', '');
  if (!normalized) return 0;
  if (!/^\d*\.?\d+$/.test(normalized) && !/^\d+\.$/.test(normalized)) return NaN;
  return Number(normalized);
}

function getToken(tokens, symbol) {
  return tokens.find((token) => token.currency === symbol);
}

function updateButton(state, message) {
  const amount = parseAmount(payInput.value);
  const valid = Number.isFinite(amount) && amount > 0 &&
    amount <= getBalance(state.selected.pay) && state.selected.pay !== state.selected.receive &&
    getToken(state.tokens, state.selected.pay) && getToken(state.tokens, state.selected.receive);
  submitButton.disabled = state.loading || !valid;
  submitButton.classList.toggle('is-loading', state.loading);
  submitButton.querySelector('.button-label').textContent = state.loading
    ? 'Preparing your swap…'
    : message || (valid ? 'Review swap' : 'Enter an amount');
}

function renderSelectedTokens(state) {
  for (const side of ['pay', 'receive']) {
    const symbol = state.selected[side];
    const token = getToken(state.tokens, symbol);
    const image = $(`#${side}-icon`);
    image.src = `${ICON_ROOT}${encodeURIComponent(symbol)}.svg`;
    image.alt = `${symbol} token icon`;
    image.onerror = () => {
      image.onerror = null;
      image.style.display = 'none';
    };
    image.style.display = '';
    $(`#${side}-symbol`).textContent = symbol;
    $(`#${side}-balance`).textContent = `${formatAmount(getBalance(symbol), 4)} ${symbol}`;
    $(`#${side}-panel`).dataset.priceAvailable = String(Boolean(token));
  }
}

export function renderSwap(state) {
  errorBox.textContent = '';
  renderSelectedTokens(state);

  const amount = parseAmount(payInput.value);
  const payToken = getToken(state.tokens, state.selected.pay);
  const receiveToken = getToken(state.tokens, state.selected.receive);
  const rate = payToken && receiveToken ? payToken.price / receiveToken.price : NaN;
  const result = amount * rate;

  $('#exchange-rate').textContent = Number.isFinite(rate)
    ? `1 ${state.selected.pay} = ${formatAmount(rate, 8)} ${state.selected.receive}`
    : 'Rate unavailable';

  if (payInput.value.trim() && !Number.isFinite(amount)) {
    receiveInput.value = '';
    errorBox.textContent = 'Enter a valid amount using numbers and a decimal point.';
    updateButton(state, 'Enter a valid amount');
    return;
  }

  if (!payInput.value.trim() || amount === 0) {
    receiveInput.value = '';
    $('#pay-usd').textContent = '≈ $0.00';
    $('#receive-usd').textContent = '≈ $0.00';
    updateButton(state);
    return;
  }

  if (!payToken || !receiveToken) {
    receiveInput.value = '';
    errorBox.textContent = 'A price is not available for this token pair.';
    updateButton(state, 'Price unavailable for this pair');
    return;
  }

  if (state.selected.pay === state.selected.receive) {
    receiveInput.value = '';
    errorBox.textContent = 'Choose two different tokens to make a swap.';
    updateButton(state, 'Choose two different tokens');
    return;
  }

  receiveInput.value = formatAmount(result, 8);
  $('#pay-usd').textContent = `≈ ${formatUsd(amount * payToken.price)}`;
  $('#receive-usd').textContent = `≈ ${formatUsd(result * receiveToken.price)}`;

  if (amount > getBalance(state.selected.pay)) {
    errorBox.textContent = `Your demo balance is ${formatAmount(getBalance(state.selected.pay), 4)} ${state.selected.pay}.`;
    updateButton(state, 'Insufficient demo balance');
  } else {
    updateButton(state);
  }
}

export function getSwapFormElements() {
  return { payInput, receiveInput, submitButton };
}

export function getSwapQuote(state) {
  const payAmount = parseAmount(payInput.value);
  const payToken = getToken(state.tokens, state.selected.pay);
  const receiveToken = getToken(state.tokens, state.selected.receive);
  if (!Number.isFinite(payAmount) || !payToken || !receiveToken) return null;
  return {
    payAmount,
    receiveAmount: payAmount * payToken.price / receiveToken.price,
    paySymbol: state.selected.pay,
    receiveSymbol: state.selected.receive,
  };
}
