/**
 * services/marketService.js
 *
 * Сервис получения рыночных данных через Twelve Data API.
 *
 * Архитектура:
 * - Принимает зависимости (logger, metrics, state) через конструктор (DI-friendly)
 * - Batch-запрос для всех символов (1 API-запрос = 8 кредитов)
 * - Fallback на индивидуальные запросы при ошибке batch
 * - Валидация ответа через Zod (validateBatchResponse)
 * - Нормализация символов через symbolValidator
 * - Квота-aware: проверяет лимиты перед запросом, трекает использование
 * - Correlation ID в каждом запросе (через AsyncLocalStorage)
 */

import { config, INSTRUMENTS } from '../config/index.js';
import { withRetry } from '../utils/retry.js';
import { logger }    from '../utils/logger.js';
import { getCorrelationId } from '../utils/correlationId.js';
import { validateBatchResponse } from '../config/schema.js';
import { normalizeAndFilter }    from '../validators/symbolValidator.js';

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Выполняет fetch с таймаутом.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {object} [extraHeaders]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, timeoutMs, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':    'TelegramMarketBot/2.0',
        'Accept':        'application/json',
        'X-Correlation': getCorrelationId(),
        ...extraHeaders,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Парсит raw-котировку в наш внутренний формат.
 * @param {object} raw    - Валидированный объект котировки
 * @param {string} symbol
 * @returns {{ price, change, previousClose, name, isMarketOpen, datetime }}
 */
function parseQuote(raw, symbol) {
  return {
    symbol,
    price:         parseFloat(raw.close),
    change:        parseFloat(raw.percent_change ?? 0),
    previousClose: raw.previous_close ? parseFloat(raw.previous_close) : null,
    name:          raw.name || symbol,
    isMarketOpen:  raw.is_market_open ?? null,
    datetime:      raw.datetime || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MarketService
// ─────────────────────────────────────────────────────────────────────────────

export class MarketService {
  #cfg;      // config.twelveData
  #metrics;  // MetricsService
  #state;    // StateService

  /**
   * @param {object} deps
   * @param {import('../services/metricsService.js').MetricsService} deps.metrics
   * @param {import('../services/stateService.js').StateService}     deps.state
   */
  constructor(deps = {}) {
    this.#cfg     = config.twelveData;
    this.#metrics = deps.metrics ?? null;
    this.#state   = deps.state   ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: HTTP
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Выполняет batch /quote запрос для массива символов.
   * Возвращает сырой объект ответа (до валидации).
   *
   * @param {string[]} symbols  - Нормализованные символы
   * @returns {Promise<object>}
   */
  async #fetchBatch(symbols) {
    const url = new URL(`${this.#cfg.baseUrl}/quote`);
    url.searchParams.set('symbol', symbols.join(','));
    url.searchParams.set('apikey', this.#cfg.apiKey);

    logger.debug('Twelve Data batch request', {
      url:     url.toString().replace(this.#cfg.apiKey, '***'),
      symbols: symbols.length,
    });

    const response = await fetchWithTimeout(url.toString(), this.#cfg.timeout);

    // Защита от non-2xx HTTP ошибок
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
    }

    // Защита от пустого / не-JSON ответа
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const body = await response.text();
      throw new Error(`Unexpected content-type: ${contentType}. Body: ${body.slice(0, 200)}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error(`Malformed JSON in API response: ${e.message}`);
    }

    // Ответ на уровне всего запроса — ошибка
    if (data?.status === 'error' || (data?.code && data?.code !== 200)) {
      throw new Error(`Twelve Data API error [${data.code}]: ${data.message}`);
    }

    // Пустой ответ
    if (!data || Object.keys(data).length === 0) {
      throw new Error('Empty response from Twelve Data API');
    }

    // Если запрошен один символ — нормализуем в batch-формат
    if (symbols.length === 1 && data.symbol) {
      return { [data.symbol]: data };
    }

    return data;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Fallback
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Запрашивает символы по одному (fallback при провале batch).
   * @param {string[]} symbols
   * @returns {Promise<object>}
   */
  async #fetchIndividual(symbols) {
    logger.info(`Fallback: individual requests for ${symbols.length} symbols`);

    const results = await Promise.allSettled(
      symbols.map((s) =>
        withRetry(() => this.#fetchBatch([s]), {
          retries: 2,
          delay:   1_000,
          label:   `single:${s}`,
        })
      )
    );

    const combined = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        Object.assign(combined, r.value);
      } else {
        logger.warn(`Individual request failed for ${symbols[i]}`, { error: r.reason?.message });
        combined[symbols[i]] = null;
      }
    });

    return combined;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public: fetchMarketData
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Получает котировки для всех инструментов из INSTRUMENTS.
   *
   * @returns {Promise<Record<string, {price, change, ...}|null>>}
   */
  async fetchMarketData() {
    const startMs = Date.now();

    logger.separator('Market Data Fetch');
    logger.info('Запрос рыночных данных от Twelve Data API...');

    // Получаем и нормализуем символы
    const instrumentKeys  = Object.keys(INSTRUMENTS);
    const rawSymbols      = instrumentKeys.map((k) => INSTRUMENTS[k].symbol);
    const validSymbols    = normalizeAndFilter(rawSymbols);
    const symbolCount     = validSymbols.length;

    // Проверяем квоту
    if (this.#state) {
      this.#state.initQuota(this.#cfg.dailyQuota);
      if (!this.#state.hasQuota(symbolCount)) {
        const quota = this.#state.getQuota();
        logger.error('API quota exceeded! Skipping fetch.', {
          used:      quota.used,
          limit:     quota.dailyLimit,
          required:  symbolCount,
          resetAt:   quota.resetAt,
        });
        return this.#emptyResult(instrumentKeys);
      }
    }

    // ── Шаг 1: Batch-запрос ──────────────────────────────────────────────
    let rawData = {};
    let usedBatch = false;

    this.#metrics?.increment('api.requests');

    try {
      rawData = await withRetry(
        () => this.#fetchBatch(validSymbols),
        {
          retries:     this.#cfg.retries,
          delay:       this.#cfg.retryDelay,
          label:       'batch-quote',
        }
      );
      usedBatch = true;
      logger.info('Batch-запрос успешен');
    } catch (batchErr) {
      this.#metrics?.increment('api.failures');
      logger.warn('Batch-запрос провалился, переключаемся на индивидуальные', {
        error: batchErr.message,
      });

      // ── Шаг 2: Fallback ──────────────────────────────────────────────
      try {
        rawData = await this.#fetchIndividual(validSymbols);
      } catch (indErr) {
        this.#metrics?.increment('api.failures');
        logger.error('Все запросы к Twelve Data провалились', { error: indErr.message });
      }
    }

    // ── Валидация ответа через Zod ────────────────────────────────────────
    const { valid: validQuotes, errors: validationErrors } = validateBatchResponse(rawData);

    if (Object.keys(validationErrors).length > 0) {
      logger.warn('Часть символов не прошла валидацию', { errors: validationErrors });
    }

    // ── Трекинг квоты ────────────────────────────────────────────────────
    const creditsUsed = usedBatch ? symbolCount : Object.keys(rawData).length;
    this.#state?.incrementQuota(creditsUsed);
    this.#metrics?.increment('api.quota.used', creditsUsed);

    // ── Парсинг в внутренний формат ───────────────────────────────────────
    const marketData = {};
    const available  = [];
    const missing    = [];

    for (const key of instrumentKeys) {
      const { symbol } = INSTRUMENTS[key];
      const quoteRaw   = validQuotes[symbol] ?? null;

      if (quoteRaw) {
        marketData[key] = parseQuote(quoteRaw, symbol);
        available.push(symbol);

        logger.debug(`✓ ${symbol}`, {
          price:    marketData[key].price,
          change:   `${marketData[key].change > 0 ? '+' : ''}${marketData[key].change.toFixed(2)}%`,
          open:     marketData[key].isMarketOpen,
        });
      } else {
        marketData[key] = null;
        missing.push(symbol);
      }
    }

    // ── Метрики и логи ────────────────────────────────────────────────────
    const latencyMs = Date.now() - startMs;
    this.#metrics?.recordLatency('api.latency', latencyMs);

    logger.info('Данные получены', {
      latencyMs,
      available: available.length,
      missing:   missing.length,
      ...(missing.length > 0 && { missingSymbols: missing }),
      quota:     this.#state?.getQuota(),
    });

    return marketData;
  }

  /** Создаёт пустой результат (все null) для случаев отказа */
  #emptyResult(keys) {
    return Object.fromEntries(keys.map((k) => [k, null]));
  }
}
