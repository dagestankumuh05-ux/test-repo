/**
 * services/marketDataService.js
 * Получение рыночных данных из Twelve Data и Binance API.
 *
 * Стратегия минимизации запросов:
 *  - Один batch-запрос к Twelve Data для всех non-crypto инструментов
 *  - Один batch-запрос к Binance для BTC + ETH
 *  - Fallback к Twelve Data если Binance недоступен
 */

import { config }           from '../config/config.js';
import { logger }           from '../utils/logger.js';
import { fetchWithRetry }   from '../utils/retry.js';

// ─── Константы ────────────────────────────────────────────────────────────────

const TD  = config.twelveData;
const BIN = config.binance;

// Binance rate-limit: 1200 запросов / минуту (вес одного 24hr batch ≈ 40)
// Twelve Data free: 800 запросов / день → один batch-запрос экономит лимит

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/**
 * Безопасно распарсить число из строки или числа.
 * @param {*} val
 * @returns {number|null}
 */
function parseNum(val) {
  if (val == null) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/**
 * Нормализовать один ответ от Twelve Data quote endpoint.
 * @param {Object} raw  — объект ответа для одного символа
 * @returns {{ price: number|null, changePercent: number|null }}
 */
function normalizeTD(raw) {
  if (!raw || raw.status === 'error' || raw.code) {
    return { price: null, changePercent: null, error: raw?.message || 'API error' };
  }
  return {
    price:         parseNum(raw.close),
    changePercent: parseNum(raw.percent_change),
  };
}

// ─── Twelve Data: batch quote ─────────────────────────────────────────────────

/**
 * Один batch-запрос ко всем non-crypto инструментам через /quote.
 * Возвращает объект { symbolKey: AssetData }.
 */
async function fetchTwelveDataBatch() {
  // Символы для batch-запроса
  const symbolMap = {
    'EUR/USD':   'eurUsd',
    'USD/RUB':   'usdRub',
    'XAU/USD':   'gold',
    'BZ=F':      'brent',
    'IMOEX:MOEX':'imoex',
    'SPX':       'sp500',
  };

  const symbols    = Object.keys(symbolMap).join(',');
  const url = `${TD.baseUrl}/quote?symbol=${encodeURIComponent(symbols)}&apikey=${TD.apiKey}&dp=4`;

  logger.info('[TwelveData] Batch-запрос котировок', { symbols });

  const response = await fetchWithRetry(url, {}, { context: 'TwelveData' });

  if (!response.ok) {
    throw new Error(`Twelve Data HTTP ${response.status}: ${response.statusText}`);
  }

  const json = await response.json();

  // Если статус = error (невалидный ключ и т.п.)
  if (json.status === 'error') {
    throw new Error(`Twelve Data API error: ${json.message}`);
  }

  // Разобрать ответ — может быть flat-объект (один символ) или объект по символам
  const result = {};

  for (const [symbol, key] of Object.entries(symbolMap)) {
    // Batch-ответ: json[symbol] | при одном символе — json напрямую
    const raw = Object.keys(symbolMap).length === 1 ? json : json[symbol];
    result[key] = normalizeTD(raw);

    if (result[key].error) {
      logger.warn(`[TwelveData] Ошибка для ${symbol}: ${result[key].error}`);
    } else {
      logger.debug(`[TwelveData] ${symbol} = ${result[key].price} (${result[key].changePercent}%)`);
    }
  }

  return result;
}

// ─── Binance: batch 24h ticker ────────────────────────────────────────────────

/**
 * Получить BTC и ETH за один запрос к Binance.
 * @returns {{ btc: AssetData, eth: AssetData }}
 */
async function fetchBinanceCrypto() {
  // symbols=["BTCUSDT","ETHUSDT"] — один запрос вместо двух
  const symbolsParam = encodeURIComponent(JSON.stringify(BIN.symbols));
  const url = `${BIN.baseUrl}/api/v3/ticker/24hr?symbols=${symbolsParam}`;

  logger.info('[Binance] Запрос крипто-котировок', { symbols: BIN.symbols });

  const response = await fetchWithRetry(url, {}, { context: 'Binance' });

  if (!response.ok) {
    throw new Error(`Binance HTTP ${response.status}: ${response.statusText}`);
  }

  const tickers = await response.json();

  const result = {};

  for (const ticker of tickers) {
    const price         = parseNum(ticker.lastPrice);
    const changePercent = parseNum(ticker.priceChangePercent);

    if (ticker.symbol === 'BTCUSDT') {
      result.btc = { price, changePercent };
      logger.debug(`[Binance] BTC = ${price} (${changePercent}%)`);
    } else if (ticker.symbol === 'ETHUSDT') {
      result.eth = { price, changePercent };
      logger.debug(`[Binance] ETH = ${price} (${changePercent}%)`);
    }
  }

  // Если символ не пришёл — пометить ошибкой
  if (!result.btc) result.btc = { price: null, changePercent: null, error: 'Symbol not found' };
  if (!result.eth) result.eth = { price: null, changePercent: null, error: 'Symbol not found' };

  return result;
}

// ─── Fallback: крипта через Twelve Data ───────────────────────────────────────

/**
 * Fallback-запрос крипты через Twelve Data (используется если Binance недоступен).
 * @returns {{ btc: AssetData, eth: AssetData }}
 */
async function fetchCryptoFallback() {
  logger.warn('[CryptoFallback] Binance недоступен, запрашиваем крипту через Twelve Data');

  const symbols = 'BTC/USD,ETH/USD';
  const url     = `${TD.baseUrl}/quote?symbol=${encodeURIComponent(symbols)}&apikey=${TD.apiKey}&dp=2`;

  const response = await fetchWithRetry(url, {}, { context: 'TwelveData-Crypto' });

  if (!response.ok) {
    throw new Error(`Twelve Data crypto fallback HTTP ${response.status}`);
  }

  const json = await response.json();

  return {
    btc: normalizeTD(json['BTC/USD'] ?? json),
    eth: normalizeTD(json['ETH/USD'] ?? json),
  };
}

// ─── Основная экспортируемая функция ─────────────────────────────────────────

/**
 * Собрать все рыночные данные.
 * Запускает Binance и Twelve Data параллельно для скорости.
 * При недоступности Binance использует Twelve Data fallback.
 *
 * @returns {Promise<Object>} — полный объект со всеми активами
 */
export async function fetchAllMarketData() {
  logger.info('[MarketData] Начало сбора данных');
  const startTime = Date.now();

  // ── Параллельные запросы: Binance + Twelve Data ────────────────────────────
  const [cryptoResult, tdResult] = await Promise.allSettled([
    // Крипта (Binance primary, Twelve Data fallback)
    fetchBinanceCrypto().catch(async (err) => {
      logger.warn(`[Binance] Ошибка: ${err.message} — переключаемся на fallback`);
      return fetchCryptoFallback();
    }),
    // Остальные активы через Twelve Data
    fetchTwelveDataBatch(),
  ]);

  // ── Обработка результатов ─────────────────────────────────────────────────
  const errorAsset = (name) => ({
    price:         null,
    changePercent: null,
    error:         `Не удалось получить данные: ${name}`,
  });

  const crypto = cryptoResult.status === 'fulfilled'
    ? cryptoResult.value
    : { btc: errorAsset('BTC'), eth: errorAsset('ETH') };

  if (cryptoResult.status === 'rejected') {
    logger.error('[MarketData] Крипта недоступна (оба источника)', {
      error: cryptoResult.reason?.message,
    });
  }

  const td = tdResult.status === 'fulfilled'
    ? tdResult.value
    : {
        usdRub: errorAsset('USD/RUB'),
        eurUsd: errorAsset('EUR/USD'),
        gold:   errorAsset('XAU/USD'),
        brent:  errorAsset('BRENT'),
        imoex:  errorAsset('IMOEX'),
        sp500:  errorAsset('SPX'),
      };

  if (tdResult.status === 'rejected') {
    logger.error('[MarketData] Twelve Data batch недоступен', {
      error: tdResult.reason?.message,
    });
  }

  const elapsed = Date.now() - startTime;
  logger.info(`[MarketData] Данные собраны за ${elapsed}мс`);

  return {
    btc:    crypto.btc,
    eth:    crypto.eth,
    usdRub: td.usdRub,
    eurUsd: td.eurUsd,
    gold:   td.gold,
    brent:  td.brent,
    imoex:  td.imoex,
    sp500:  td.sp500,
  };
}
