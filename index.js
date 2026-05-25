/**
 * telegram-market-bot
 *
 * Каждый день в 07:00 CET отправляет в Telegram утреннюю сводку рынков.
 * Данные: Twelve Data API (один batch-запрос).
 *
 * Зависимости: axios, dotenv, node-cron
 */

'use strict';

require('dotenv').config();
const axios = require('axios');
const cron  = require('node-cron');

// ─── Переменные окружения ──────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;

// Проверяем наличие всех обязательных переменных
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TWELVE_DATA_API_KEY) {
  console.error('❌  Не заданы переменные окружения!');
  console.error('    Заполни .env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TWELVE_DATA_API_KEY');
  process.exit(1);
}

// ─── Символы для запроса ───────────────────────────────────────────────────────
//
//  BTC/USD  — Bitcoin
//  ETH/USD  — Ethereum
//  USD/RUB  — Доллар / Рубль
//  XAU/USD  — Золото
//  UKOIL    — Нефть Brent (UK Oil)
//  SPX      — Индекс S&P 500
//  MOEX     — Индекс Московской биржи
//
const SYMBOLS = 'BTC/USD,ETH/USD,USD/RUB,XAU/USD,UKOIL,SPX,MOEX';

// ─── Утилиты ──────────────────────────────────────────────────────────────────

/**
 * Логирует сообщение с временной меткой ISO.
 */
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Форматирует число с разделителями тысяч.
 * Пример: 108240.5 → "108,240.50"
 *
 * @param {string|number} value    — значение для форматирования
 * @param {number}        decimals — знаков после запятой (по умолч. 2)
 * @returns {string}
 */
function fmt(value, decimals = 2) {
  const num = parseFloat(value);
  if (isNaN(num)) return 'N/A';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Возвращает текущее время в CET/CEST (Europe/Berlin).
 * Пример: "07:00"
 */
function getCETTime() {
  return new Date().toLocaleTimeString('ru-RU', {
    hour:     '2-digit',
    minute:   '2-digit',
    timeZone: 'Europe/Berlin',
  });
}

/**
 * Асинхронная пауза.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Получение данных ─────────────────────────────────────────────────────────

/**
 * Делает один batch-запрос к Twelve Data API /price.
 * При ошибке повторяет до `retries` раз с задержкой 2 → 4 → 6 секунд.
 *
 * @param {number} retries — максимальное кол-во попыток (по умолч. 3)
 * @returns {Promise<Object>} — объект вида { 'BTC/USD': { price: '...' }, ... }
 */
async function fetchMarketData(retries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      log(`Запрос к Twelve Data... (попытка ${attempt}/${retries})`);

      const { data } = await axios.get('https://api.twelvedata.com/price', {
        params: {
          symbol: SYMBOLS,
          apikey: TWELVE_DATA_API_KEY,
        },
        timeout: 15_000, // 15 секунд — если API не отвечает
      });

      log('Данные получены успешно.');
      return data;

    } catch (err) {
      lastError = err;
      log(`Попытка ${attempt} провалилась: ${err.message}`);

      if (attempt < retries) {
        const delay = attempt * 2000; // 2с, 4с, 6с
        log(`Следующая попытка через ${delay / 1000}с...`);
        await sleep(delay);
      }
    }
  }

  throw lastError; // Все попытки исчерпаны
}

// ─── Формирование сообщения ────────────────────────────────────────────────────

/**
 * Безопасно извлекает цену из ответа API.
 * Если символ не найден или API вернул ошибку — возвращает null.
 *
 * @param {Object} data   — весь ответ от API
 * @param {string} symbol — символ, напр. 'BTC/USD'
 * @returns {string|null}
 */
function getPrice(data, symbol) {
  const entry = data[symbol];
  // Если запись отсутствует, содержит код ошибки или пустую цену
  if (!entry || entry.code || !entry.price) return null;
  return entry.price;
}

/**
 * Собирает отформатированное Telegram-сообщение.
 *
 * @param {Object} data — ответ Twelve Data API
 * @returns {string}
 */
function buildMessage(data) {
  const btc   = fmt(getPrice(data, 'BTC/USD'), 0);
  const eth   = fmt(getPrice(data, 'ETH/USD'), 0);
  const rub   = fmt(getPrice(data, 'USD/RUB'), 2);
  const gold  = fmt(getPrice(data, 'XAU/USD'), 0);
  const oil   = fmt(getPrice(data, 'UKOIL'),   2);
  const sp500 = fmt(getPrice(data, 'SPX'),     0);
  const moex  = fmt(getPrice(data, 'MOEX'),    0);

  const time = getCETTime();

  // Markdown-разметка для Telegram (*жирный*)
  return [
    '📊 *Утренний рынок*',
    '',
    `₿ BTC — $${btc}`,
    `Ξ ETH — $${eth}`,
    '',
    `💵 USD/RUB — ${rub}`,
    '',
    `🥇 Gold — $${gold}`,
    `🛢 Brent — $${oil}`,
    '',
    `🇷🇺 MOEX — ${moex}`,
    `🇺🇸 S&P500 — ${sp500}`,
    '',
    `⏰ ${time} CET`,
  ].join('\n');
}

// ─── Отправка в Telegram ──────────────────────────────────────────────────────

/**
 * Отправляет текстовое сообщение в Telegram-чат через Bot API.
 *
 * @param {string} text — текст сообщения (поддерживает Markdown)
 * @returns {Promise<Object>} — ответ Telegram API
 */
async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const { data } = await axios.post(
    url,
    {
      chat_id:    TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
    },
    { timeout: 10_000 }
  );

  return data;
}

// ─── Основная функция ─────────────────────────────────────────────────────────

/**
 * Точка входа: получает данные и отправляет сводку в Telegram.
 * Вызывается по расписанию node-cron.
 */
async function sendMarketUpdate() {
  log('════════════════════════════════');
  log('Запуск утренней сводки рынков...');

  try {
    // 1. Получаем данные
    const data = await fetchMarketData(3);

    // 2. Формируем сообщение
    const message = buildMessage(data);

    // 3. Отправляем в Telegram
    log('Отправка сообщения в Telegram...');
    await sendTelegramMessage(message);

    log('✅ Сообщение отправлено успешно!');

  } catch (err) {
    log(`❌ Ошибка: ${err.message}`);

    // Пытаемся отправить уведомление об ошибке прямо в чат
    try {
      await sendTelegramMessage(
        `❌ Ошибка получения данных рынка\\.\n\`${err.message}\``
      );
    } catch (telegramErr) {
      log(`Не удалось отправить уведомление об ошибке: ${telegramErr.message}`);
    }
  }

  log('════════════════════════════════');
}

// ─── Запуск ───────────────────────────────────────────────────────────────────

log('🤖 Telegram Market Bot запущен.');
log('📅 Расписание: каждый день в 07:00 CET (Europe/Berlin).');
log('');
log('💡 Для немедленного теста раскомментируй строку в конце файла.');
log('');

// Расписание: 07:00 каждый день, таймзона CET/CEST
cron.schedule('0 7 * * *', sendMarketUpdate, {
  timezone: 'Europe/Berlin',
});

// ─── Раскомментируй для ручного теста ─────────────────────────────────────────
// sendMarketUpdate();
