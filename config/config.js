/**
 * config/config.js
 * Централизованная конфигурация приложения из переменных окружения.
 * Импортируется из .env файла через dotenv.
 */

import dotenv from 'dotenv';
dotenv.config();

// ─── Валидация обязательных переменных ──────────────────────────────────────
function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `❌ Отсутствует обязательная переменная окружения: ${name}\n` +
      `   Скопируйте .env.example в .env и заполните все значения.`
    );
  }
  return value.trim();
}

function optionalEnv(name, defaultValue) {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : defaultValue;
}

// ─── Экспорт конфигурации ────────────────────────────────────────────────────
export const config = {
  // Telegram
  telegram: {
    botToken:  requireEnv('TELEGRAM_BOT_TOKEN'),
    chatId:    requireEnv('TELEGRAM_CHAT_ID'),
    parseMode: 'HTML',          // Используем HTML-разметку в сообщениях
    apiBase:   'https://api.telegram.org',
  },

  // Twelve Data API (основной источник котировок)
  twelveData: {
    apiKey:  requireEnv('TWELVE_DATA_API_KEY'),
    baseUrl: 'https://api.twelvedata.com',
    // Все символы одним batch-запросом для экономии лимита
    symbols: {
      forex: ['EUR/USD', 'USD/RUB'],
      gold:  'XAU/USD',
      oil:   'BZ=F',    // Brent Crude Oil Futures (NYMEX)
      imoex: 'IMOEX:MOEX',
      sp500: 'SPX',
    },
  },

  // Binance API (криптовалюты, без ключа)
  binance: {
    baseUrl: 'https://api.binance.com',
    symbols: ['BTCUSDT', 'ETHUSDT'],
  },

  // Планировщик
  scheduler: {
    cronTime: optionalEnv('CRON_TIME', '0 7 * * *'),
    timezone: optionalEnv('TIMEZONE', 'Europe/Amsterdam'),
  },

  // HTTP-запросы
  http: {
    timeoutMs:     parseInt(optionalEnv('REQUEST_TIMEOUT_MS', '10000'), 10),
    retryAttempts: parseInt(optionalEnv('RETRY_ATTEMPTS', '3'), 10),
    retryBaseDelay: 1000, // мс, удваивается при каждой попытке (exponential backoff)
  },

  // Логирование
  logging: {
    level:         optionalEnv('LOG_LEVEL', 'info'),
    retentionDays: parseInt(optionalEnv('LOG_RETENTION_DAYS', '14'), 10),
    dir:           './logs',
  },
};
