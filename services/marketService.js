/**
 * services/marketService.js
 *
 * Сервис получения рыночных данных через Twelve Data API.
 *
 * Документация API: https://twelvedata.com/docs
 * Endpoint: GET /quote?symbol=BTC/USD,ETH/USD,...&apikey=KEY
 *
 * Стратегия запросов:
 *   - Все 8 символов запрашиваются ОДНИМ batch-запросом (экономия API-кредитов)
 *   - При ошибке batch-запроса выполняются индивидуальные запросы (fallback)
 *   - Каждый запрос защищён retry с exponential backoff
 *   - Каждый запрос имеет таймаут
 *
 * Потребление API-кредитов (план Free: 800/день):
 *   - 1 batch-запрос = 8 кредитов
 *   - В сутки: 8 кредитов (отправляем 1 раз в день)
 */

import { config } from '../config/index.js';
import { INSTRUMENTS } from '../config/instruments.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные HTTP-функции
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Выполняет fetch-запрос с таймаутом.
 * Node.js 20+ поддерживает AbortSignal.timeout() нативно.
 *
 * @param {string} url       - URL для запроса
 * @param {number} timeoutMs - Таймаут в миллисекундах
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Таймаут запроса: ${timeoutMs}ms превышен`));
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TelegramMarketBot/1.0',
        'Accept': 'application/json',
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Парсинг ответа Twelve Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Проверяет, является ли объект ошибкой от Twelve Data API.
 * API возвращает { code: 400, message: "...", status: "error" } для ошибочных символов.
 *
 * @param {object} obj
 * @returns {boolean}
 */
function isApiError(obj) {
  return obj && (obj.status === 'error' || (obj.code && obj.code !== 200));
}

/**
 * Парсит один объект котировки от Twelve Data в наш внутренний формат.
 *
 * @param {object|null} quoteObj - Объект котировки из API
 * @param {string}      symbol   - Символ (для логов)
 * @returns {{ price: number, change: number, previousClose: number, name: string }|null}
 */
function parseQuote(quoteObj, symbol) {
  if (!quoteObj) return null;

  // Ошибка на уровне конкретного символа (например, символ не найден)
  if (isApiError(quoteObj)) {
    logger.warn(`Символ ${symbol} вернул ошибку API`, {
      code: quoteObj.code,
      message: quoteObj.message,
    });
    return null;
  }

  const price = parseFloat(quoteObj.close);
  const change = parseFloat(quoteObj.percent_change);
  const previousClose = parseFloat(quoteObj.previous_close);

  if (isNaN(price) || price === 0) {
    logger.warn(`Символ ${symbol}: некорректная цена`, { close: quoteObj.close });
    return null;
  }

  return {
    symbol,
    price,
    change: isNaN(change) ? 0 : change,
    previousClose: isNaN(previousClose) ? null : previousClose,
    name: quoteObj.name || symbol,
    isMarketOpen: quoteObj.is_market_open ?? null,
    datetime: quoteObj.datetime || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API-запросы
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Выполняет batch-запрос к /quote для списка символов.
 * Возвращает объект { "BTC/USD": {...}, "ETH/USD": {...}, ... }
 *
 * @param {string[]} symbols - Массив символов Twelve Data
 * @returns {Promise<object>} - Словарь { symbol: quoteObject }
 */
async function fetchBatchQuotes(symbols) {
  const symbolList = symbols.join(',');
  const url = new URL(`${config.twelveData.baseUrl}/quote`);
  url.searchParams.set('symbol', symbolList);
  url.searchParams.set('apikey', config.twelveData.apiKey);

  logger.debug(`Twelve Data batch request: ${symbols.length} symbols`, { symbols });

  const response = await fetchWithTimeout(url.toString(), config.twelveData.timeout);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Проверяем ошибку на уровне всего запроса
  if (isApiError(data)) {
    throw new Error(`Twelve Data API error: ${data.message} (code: ${data.code})`);
  }

  // Если запрошен ОДИН символ, API возвращает объект напрямую (не обёртку)
  // Нормализуем в формат { "SYMBOL": quoteObject }
  if (symbols.length === 1 && data.symbol) {
    return { [data.symbol]: data };
  }

  return data;
}

/**
 * Fallback: запрашивает каждый символ индивидуально (если batch упал).
 * Запросы выполняются параллельно для скорости.
 *
 * @param {string[]} symbols
 * @returns {Promise<object>} - Словарь { symbol: quoteObject }
 */
async function fetchIndividualQuotes(symbols) {
  logger.info(`Fallback: индивидуальные запросы для ${symbols.length} символов`);

  const results = await Promise.allSettled(
    symbols.map((symbol) =>
      withRetry(
        () => fetchBatchQuotes([symbol]),
        {
          retries: 2,
          delay: 1000,
          label: symbol,
        }
      )
    )
  );

  const combined = {};
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      Object.assign(combined, result.value);
    } else {
      logger.error(`Не удалось получить данные для ${symbols[i]}`, {
        error: result.reason?.message,
      });
      combined[symbols[i]] = null;
    }
  });

  return combined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Основная функция
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Получает рыночные данные для всех инструментов из Twelve Data API.
 *
 * Стратегия:
 * 1. Batch-запрос для всех 8 символов (1 API-запрос)
 * 2. Если batch провалился — индивидуальные запросы с retry (fallback)
 *
 * @returns {Promise<{
 *   btc: object|null,
 *   eth: object|null,
 *   usdRub: object|null,
 *   eurUsd: object|null,
 *   gold: object|null,
 *   brent: object|null,
 *   imoex: object|null,
 *   sp500: object|null,
 * }>}
 */
export async function fetchMarketData() {
  logger.separator('Запрос рыночных данных');
  logger.info('Получение данных от Twelve Data API...');

  const startTime = Date.now();

  // Собираем все символы из конфигурации
  const instrumentKeys = Object.keys(INSTRUMENTS);
  const symbols = instrumentKeys.map((key) => INSTRUMENTS[key].symbol);

  let rawData = {};

  // ── Шаг 1: Попытка batch-запроса ──────────────────────────────────────────
  try {
    rawData = await withRetry(
      () => fetchBatchQuotes(symbols),
      {
        retries: config.twelveData.retries,
        delay: config.twelveData.retryDelay,
        label: 'batch-quote',
      }
    );
    logger.info('Batch-запрос успешен');
  } catch (batchError) {
    logger.warn('Batch-запрос провалился, переключаемся на индивидуальные запросы', {
      error: batchError.message,
    });

    // ── Шаг 2: Fallback — индивидуальные запросы ────────────────────────────
    try {
      rawData = await fetchIndividualQuotes(symbols);
    } catch (individualError) {
      logger.error('Все попытки получить данные провалились', {
        error: individualError.message,
      });
      // Возвращаем пустой результат — бот отправит сообщение с "нет данных"
    }
  }

  // ── Парсинг результатов ───────────────────────────────────────────────────
  const marketData = {};
  const available = [];
  const unavailable = [];

  for (const key of instrumentKeys) {
    const { symbol } = INSTRUMENTS[key];
    const quoteObj = rawData[symbol] ?? null;
    const parsed = parseQuote(quoteObj, symbol);

    marketData[key] = parsed;

    if (parsed) {
      available.push(symbol);
      logger.debug(`✓ ${symbol}`, {
        price: parsed.price,
        change: parsed.change,
        marketOpen: parsed.isMarketOpen,
      });
    } else {
      unavailable.push(symbol);
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info(`Данные получены за ${elapsed}ms`, {
    доступно: available.length,
    недоступно: unavailable.length,
    ...(unavailable.length > 0 && { отсутствуют: unavailable }),
  });

  return marketData;
}
