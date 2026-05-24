/**
 * utils/formatter.js
 * Форматирование рыночных данных в красивое Telegram HTML-сообщение.
 */

/**
 * Объект с данными одного инструмента.
 * @typedef {Object} AssetData
 * @property {number|null} price          — текущая цена
 * @property {number|null} changePercent  — изменение за 24ч в %
 * @property {string}      [error]        — ошибка если данные не получены
 */

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/**
 * Форматировать число с нужным кол-вом знаков и разделителями тысяч.
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
function formatNumber(value, decimals = 2) {
  if (value == null || isNaN(value)) return 'N/A';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Форматировать изменение в % с цветным индикатором.
 * Зелёный ▲ — рост, Красный ▼ — падение, Серый — без изменений.
 * @param {number|null} changePercent
 * @returns {string}  HTML-строка
 */
function formatChange(changePercent) {
  if (changePercent == null || isNaN(changePercent)) return '';

  const abs    = Math.abs(changePercent).toFixed(2);
  const isUp   = changePercent > 0.001;
  const isDown = changePercent < -0.001;

  if (isUp)   return ` <b><code>▲ +${abs}%</code></b>`;
  if (isDown) return ` <b><code>▼ -${abs}%</code></b>`;
  return ` <code>→ 0.00%</code>`;
}

/**
 * Строка одного актива.
 * @param {string}    emoji
 * @param {string}    label
 * @param {string}    priceStr
 * @param {number|null} changePercent
 * @returns {string}
 */
function assetLine(emoji, label, priceStr, changePercent) {
  const change = formatChange(changePercent);
  return `${emoji} <b>${label}</b> — ${priceStr}${change}`;
}

/**
 * Строка с ошибкой (когда данные недоступны).
 * @param {string} emoji
 * @param {string} label
 * @returns {string}
 */
function errorLine(emoji, label) {
  return `${emoji} <b>${label}</b> — <i>данные недоступны</i>`;
}

// ─── Главная функция форматирования ─────────────────────────────────────────

/**
 * Сформировать полное сообщение для Telegram.
 *
 * @param {Object} data
 * @param {AssetData} data.btc
 * @param {AssetData} data.eth
 * @param {AssetData} data.usdRub
 * @param {AssetData} data.eurUsd
 * @param {AssetData} data.gold
 * @param {AssetData} data.brent
 * @param {AssetData} data.imoex
 * @param {AssetData} data.sp500
 * @returns {string}  Готовое HTML-сообщение
 */
export function formatMarketMessage(data) {
  const { btc, eth, usdRub, eurUsd, gold, brent, imoex, sp500 } = data;

  // Текущее время CET для подписи
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Amsterdam',
    hour:     '2-digit',
    minute:   '2-digit',
  });
  const dateStr = now.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Amsterdam',
    day:      '2-digit',
    month:    'long',
    year:     'numeric',
  });

  // ─── Блок криптовалют ──────────────────────────────────────────────────────
  const btcLine  = btc.error
    ? errorLine('₿', 'BTC/USD')
    : assetLine('₿', 'BTC/USD', `$${formatNumber(btc.price, 0)}`, btc.changePercent);

  const ethLine  = eth.error
    ? errorLine('Ξ', 'ETH/USD')
    : assetLine('Ξ', 'ETH/USD', `$${formatNumber(eth.price, 0)}`, eth.changePercent);

  // ─── Блок валют ────────────────────────────────────────────────────────────
  const rubLine  = usdRub.error
    ? errorLine('💵', 'USD/RUB')
    : assetLine('💵', 'USD/RUB', formatNumber(usdRub.price, 2), usdRub.changePercent);

  const eurLine  = eurUsd.error
    ? errorLine('💶', 'EUR/USD')
    : assetLine('💶', 'EUR/USD', formatNumber(eurUsd.price, 4), eurUsd.changePercent);

  // ─── Блок сырья ────────────────────────────────────────────────────────────
  const goldLine = gold.error
    ? errorLine('🥇', 'Gold (XAU/USD)')
    : assetLine('🥇', 'Gold', `$${formatNumber(gold.price, 1)}`, gold.changePercent);

  const oilLine  = brent.error
    ? errorLine('🛢', 'Brent Oil')
    : assetLine('🛢', 'Brent', `$${formatNumber(brent.price, 2)}`, brent.changePercent);

  // ─── Блок индексов ─────────────────────────────────────────────────────────
  const imoexLine = imoex.error
    ? errorLine('🇷🇺', 'IMOEX')
    : assetLine('🇷🇺', 'IMOEX', formatNumber(imoex.price, 0), imoex.changePercent);

  const sp500Line = sp500.error
    ? errorLine('🇺🇸', 'S&P 500')
    : assetLine('🇺🇸', 'S&amp;P 500', formatNumber(sp500.price, 0), sp500.changePercent);

  // ─── Сборка финального сообщения ───────────────────────────────────────────
  return [
    `📊 <b>Утренний рынок</b>`,
    `<i>${dateStr}</i>`,
    ``,
    `<b>— Крипто —</b>`,
    btcLine,
    ethLine,
    ``,
    `<b>— Валюты —</b>`,
    rubLine,
    eurLine,
    ``,
    `<b>— Сырьё —</b>`,
    goldLine,
    oilLine,
    ``,
    `<b>— Индексы —</b>`,
    imoexLine,
    sp500Line,
    ``,
    `⏰ ${timeStr} CET`,
  ].join('\n');
}

/**
 * Текстовый preview для логов (без HTML-тегов).
 * @param {Object} data  — те же данные что и в formatMarketMessage
 * @returns {string}
 */
export function formatMarketPreview(data) {
  const prices = [
    data.btc.price  ? `BTC $${Math.round(data.btc.price).toLocaleString()}`  : null,
    data.eth.price  ? `ETH $${Math.round(data.eth.price).toLocaleString()}`  : null,
    data.sp500.price ? `SPX ${Math.round(data.sp500.price).toLocaleString()}` : null,
  ].filter(Boolean);
  return prices.join(' | ') || 'нет данных';
}
