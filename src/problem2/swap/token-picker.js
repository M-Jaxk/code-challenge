import { formatUsd } from './format.js';

const ICON_ROOT = 'https://raw.githubusercontent.com/Switcheo/token-icons/main/tokens/';
const $ = (selector) => document.querySelector(selector);

function setTokenIcon(image, symbol) {
  image.src = `${ICON_ROOT}${encodeURIComponent(symbol)}.svg`;
  image.alt = `${symbol} token icon`;
  image.onerror = () => {
    image.onerror = null;
    image.style.display = 'none';
  };
  image.style.display = '';
}

export function createTokenPicker({ getTokens, getSelected, onSelect }) {
  const dialog = $('#token-dialog');
  const searchInput = $('#token-search');
  const tokenList = $('#token-list');
  let activeSide = 'pay';

  function render(filter = '') {
    const query = filter.trim().toLowerCase();
    const tokens = getTokens().filter((token) => token.currency.toLowerCase().includes(query));
    tokenList.replaceChildren();

    if (!tokens.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-tokens';
      empty.textContent = 'No tokens match that search.';
      tokenList.append(empty);
      return;
    }

    for (const token of tokens) {
      const button = document.createElement('button');
      button.className = 'token-option';
      button.type = 'button';
      button.role = 'option';
      button.setAttribute('aria-selected', String(token.currency === getSelected()[activeSide]));

      const image = document.createElement('img');
      image.alt = '';
      setTokenIcon(image, token.currency);

      const copy = document.createElement('span');
      copy.className = 'token-option-copy';
      const symbol = document.createElement('strong');
      symbol.textContent = token.currency;
      const availability = document.createElement('span');
      availability.textContent = 'Available to swap';
      copy.append(symbol, availability);

      const price = document.createElement('span');
      price.className = 'token-option-price';
      price.textContent = formatUsd(token.price);
      button.append(image, copy, price);
      button.addEventListener('click', () => {
        onSelect(activeSide, token.currency);
        dialog.close();
        searchInput.value = '';
      });
      tokenList.append(button);
    }
  }

  function open(side) {
    activeSide = side;
    $('#dialog-title').textContent = side === 'pay' ? 'Choose token to pay' : 'Choose token to receive';
    searchInput.value = '';
    render();
    dialog.showModal();
    searchInput.focus();
  }

  searchInput.addEventListener('input', () => render(searchInput.value));
  $('.close-dialog').addEventListener('click', () => dialog.close());

  return { open, render };
}
