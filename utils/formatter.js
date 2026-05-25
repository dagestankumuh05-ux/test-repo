/**
 * utils/formatter.js
 *
 * Форматирование данных для Telegram-сообщения.
 * Использует HTML-разметку (parse_mode: HTML).
 *
 * HTML-теги Telegram: <b>, <i>, <code>, <pre>, <a href="...">, <u>, <s>
 * Спецсимволы HTML, требующие экранирования: < > &
 */

import { INSTRUMENTS } from '../config/instruments.js';

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Экранирует HTML-спецсимволы в строке (для безопасного вывода данных).
 * @param {*} text
 * @returns {string}
 */
function escHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Оборачивает текст в HTML-тег <b> (жирный).
 * @param {string} text
 * @returns {string}
 */
function bold(text) {
  return `<b>${text}</b>`;
}

/**
 * Оборачивает текст в HTML-тег <i> (курсив).
 * @param {string} text
 * @returns {string}
 */
function italic(text) {
  return `<i>${text}</i>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Форматирование цен и изменений
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Форматирует числовую цену с разделителями разрядов и нужным кол-вом знаков.
 *
 * @param {number|string|null} price   - Цена
 * @param {number}             [decimals=2] - Знаков после запятой
 * @param {string}             [prefix='']  - Префикс ($ и т.д.)
 * @returns {string}
 */
export function formatPrice(price, decimals = 2, prefix = '') {
  if (price === null || price === undefined) return 'N/A';

  const num = parseFloat(price);
  if (isNaN(num)) return 'N/A';

  // Форматируем с разделителями тысяч (en-US: 1,234.56)
  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${prefix}${formatted}`;
}

/**
 * Форматирует процентное изменение с эмодзи-индикатором.
 *
 * @param {number|string|null} change - Процент изменения
 * @returns {{ text: string, emoji: string, isPositive: boolean|null }}
 */
export function formatChange(change) {
  if (change === null || change === undefined) {
    return { text: '', emoji: '', isPositive: null };
  }

  const num = parseFloat(change);
  if (isNaN(num)) {
    return { text: '', emoji: '', isPositive: null };
  }

  // Определяем цвет и направление
  let emoji, isPositive;
  if (num > 0) {
    emoji = '🟢';
    isPositive = true;
  } else if (num < 0) {
    emoji = '🔴';
    isPositive = false;
  } else {
    emoji = '⚪';
    isPositive = null;
  }

  const sign = num > 0 ? '+' : '';
  const text = `${emoji} ${sign}${num.toFixed(2)}%`;

  return { text, emoji, isPositive };
}

// ─────────────────────────────────────────────────────────────────────────────
// Форматирование строки инструмента
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Форматирует одну строку инструмента для Telegram.
 *
 * @param {object} instrument - Конфиг инструмента из INSTRUMENTS
 * @param {object|null} data  - Данные котировки (или null если недоступно)
 * @returns {string} - Готовая HTML-строка
 */
function formatInstrumentLine(instrument, data) {
  const { emoji, label, prefix, decimals } = instrument;

  if (!data) {
    // Инструмент недоступен (нет данных или ошибка API)
    return `${emoji} ${escHtml(label)} — ${italic('нет данных')}`;
  }

  const priceStr = formatPrice(data.price, decimals, prefix);
  const { text: changeText } = formatChange(data.change);

  // Если изменение доступно — показываем, иначе только цену
  if (changeText) {
    return `${emoji} ${escHtml(label)} — ${bold(escHtml(priceStr))} ${changeText}`;
  }
  return `${emoji} ${escHtml(label)} — ${bold(escHtml(priceStr))}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Главная функция форматирования сообщения
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Формирует полное HTML-сообщение с рыночной сводкой для Telegram.
 *
 * @param {object} marketData  - Объект с котировками (ключи: btc, eth, usdRub и т.д.)
 * @param {Date}   [date]      - Дата/время публикации (по умолчанию: сейчас)
 * @returns {string} - Готовое HTML-сообщение
 */
export function formatMarketMessage(marketData, date = new Date()) {
  const lines = [];

  // ── Заголовок ──────────────────────────────────────────────────────────────
  const timeStr = date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
    hour12: false,
  });
  const dateStr = date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Amsterdam',
  });
  // Первая буква заглавная
  const dateFormatted = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  lines.push(`📊 ${bold('Утренний рынок')}`);
  lines.push(`${italic(escHtml(dateFormatted))}`);
  lines.push('');

  // ── Крипто ────────────────────────────────────────────────────────────────
  lines.push(bold('🔐 Крипто'));
  lines.push(formatInstrumentLine(INSTRUMENTS.btc, marketData.btc));
  lines.push(formatInstrumentLine(INSTRUMENTS.eth, marketData.eth));
  lines.push('');

  // ── Валюты ────────────────────────────────────────────────────────────────
  lines.push(bold('💱 Валюты'));
  lines.push(formatInstrumentLine(INSTRUMENTS.usdRub, marketData.usdRub));
  lines.push(formatInstrumentLine(INSTRUMENTS.eurUsd, marketData.eurUsd));
  lines.push('');

  // ── Сырьё ─────────────────────────────────────────────────────────────────
  lines.push(bold('🏦 Сырьё'));
  lines.push(formatInstrumentLine(INSTRUMENTS.gold, marketData.gold));
  lines.push(formatInstrumentLine(INSTRUMENTS.brent, marketData.brent));
  lines.push('');

  // ── Индексы ───────────────────────────────────────────────────────────────
  lines.push(bold('📈 Индексы'));
  lines.push(formatInstrumentLine(INSTRUMENTS.imoex, marketData.imoex));
  lines.push(formatInstrumentLine(INSTRUMENTS.sp500, marketData.sp500));
  lines.push('');

  // ── Подвал ────────────────────────────────────────────────────────────────
  lines.push(`⏰ ${bold(`${timeStr} CET`)}`);
  lines.push(italic('Источник: Twelve Data'));

  return lines.join('\n');
}
