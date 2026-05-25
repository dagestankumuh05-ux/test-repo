/**
 * validators/symbolValidator.js
 *
 * Валидация и нормализация символов торговых инструментов.
 *
 * Обеспечивает:
 * - Проверку формата символа перед отправкой в API
 * - Нормализацию (uppercase, trim, удаление лишних символов)
 * - Определение типа инструмента по символу
 * - Кэширование результатов валидации
 */

import { SYMBOL } from '../config/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Типы символов
// ─────────────────────────────────────────────────────────────────────────────

export const SYMBOL_TYPE = Object.freeze({
  CRYPTO:    'crypto',
  FOREX:     'forex',
  COMMODITY: 'commodity',
  FUTURES:   'futures',
  INDEX:     'index',
  UNKNOWN:   'unknown',
});

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────

/** Известные крипто-базы (для более точного определения типа) */
const KNOWN_CRYPTO_BASE = new Set(['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOT', 'MATIC', 'AVAX', 'LINK']);

/** Известные форекс-базы */
const KNOWN_FOREX_BASE = new Set(['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD', 'NOK', 'SEK', 'DKK', 'RUB']);

/** Известные металлы и товарные символы */
const KNOWN_COMMODITIES = new Set(['XAU', 'XAG', 'XPT', 'XPD', 'WTI', 'BCO', 'UKOIL']);

/** Кэш результатов валидации (нет смысла валидировать одно и то же дважды) */
const validationCache = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Нормализация
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Нормализует символ: trim, uppercase, удаляет недопустимые символы.
 *
 * @param {string} symbol
 * @returns {string}
 */
export function normalizeSymbol(symbol) {
  if (typeof symbol !== 'string') return '';
  return symbol.trim().toUpperCase().replace(/\s+/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Определение типа
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Определяет тип инструмента по символу.
 *
 * @param {string} symbol - Нормализованный символ
 * @returns {string} SYMBOL_TYPE
 */
export function detectSymbolType(symbol) {
  // Futures: BZ=F, CL=F и т.д.
  if (SYMBOL.PATTERNS.FUTURES.test(symbol)) {
    return SYMBOL_TYPE.FUTURES;
  }

  // Пары: BTC/USD, EUR/USD, XAU/USD
  if (symbol.includes('/')) {
    const [base] = symbol.split('/');

    if (KNOWN_CRYPTO_BASE.has(base)) return SYMBOL_TYPE.CRYPTO;
    if (KNOWN_COMMODITIES.has(base)) return SYMBOL_TYPE.COMMODITY;
    if (KNOWN_FOREX_BASE.has(base)) return SYMBOL_TYPE.FOREX;

    // Если базовая валюта 3 символа — скорее всего форекс
    if (base.length === 3) return SYMBOL_TYPE.FOREX;
    // Иначе крипто
    return SYMBOL_TYPE.CRYPTO;
  }

  // Индекс: SPX, IMOEX:MOEX, DJI
  if (SYMBOL.PATTERNS.INDEX.test(symbol)) {
    return SYMBOL_TYPE.INDEX;
  }

  return SYMBOL_TYPE.UNKNOWN;
}

// ─────────────────────────────────────────────────────────────────────────────
// Валидация
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Результат валидации символа.
 * @typedef {{ valid: boolean, normalized: string, type: string, error?: string }} ValidationResult
 */

/**
 * Валидирует один символ.
 * Использует кэш для повторных вызовов.
 *
 * @param {string} symbol - Символ для проверки
 * @returns {ValidationResult}
 */
export function validateSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);

  // Проверяем кэш
  if (validationCache.has(normalized)) {
    return validationCache.get(normalized);
  }

  let result;

  // Базовые проверки
  if (!normalized) {
    result = { valid: false, normalized, type: SYMBOL_TYPE.UNKNOWN, error: 'Символ не может быть пустым' };
  } else if (normalized.length > SYMBOL.MAX_LENGTH) {
    result = { valid: false, normalized, type: SYMBOL_TYPE.UNKNOWN, error: `Символ слишком длинный (макс. ${SYMBOL.MAX_LENGTH} символов)` };
  } else if (/[^A-Z0-9\/=:.]/.test(normalized)) {
    result = { valid: false, normalized, type: SYMBOL_TYPE.UNKNOWN, error: `Символ содержит недопустимые символы: ${normalized}` };
  } else {
    const type = detectSymbolType(normalized);
    result = { valid: true, normalized, type };
  }

  // Кэшируем и возвращаем
  validationCache.set(normalized, result);
  return result;
}

/**
 * Валидирует массив символов.
 * Возвращает только валидные (с нормализованными значениями).
 *
 * @param {string[]} symbols
 * @returns {{ valid: ValidationResult[], invalid: ValidationResult[] }}
 */
export function validateSymbols(symbols) {
  const results = symbols.map(validateSymbol);
  return {
    valid:   results.filter((r) => r.valid),
    invalid: results.filter((r) => !r.valid),
  };
}

/**
 * Нормализует массив символов и возвращает только валидные нормализованные значения.
 * Удобно для передачи в API-запрос.
 *
 * @param {string[]} symbols
 * @returns {string[]}
 */
export function normalizeAndFilter(symbols) {
  const { valid } = validateSymbols(symbols);
  return valid.map((r) => r.normalized);
}
