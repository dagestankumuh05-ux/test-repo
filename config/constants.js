/**
 * config/constants.js
 *
 * Централизованные константы приложения.
 * Только примитивы — нет зависимостей на другие модули.
 * Используйте этот файл вместо магических чисел/строк во всём приложении.
 */

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

export const API = Object.freeze({
  TWELVE_DATA_BASE_URL: 'https://api.twelvedata.com',
  TELEGRAM_BASE_URL:    'https://api.telegram.org',

  // Twelve Data API — лимиты бесплатного плана
  QUOTA_DAILY_FREE:     800,     // кредитов в сутки (Free план)
  QUOTA_DAILY_BASIC:    55_000,  // кредитов в сутки (Basic план)
  QUOTA_WARNING_RATIO:  0.8,     // предупреждать при достижении 80% квоты

  // Таймауты запросов
  DEFAULT_TIMEOUT_MS:   15_000,
  TELEGRAM_TIMEOUT_MS:  10_000,

  // Retry
  DEFAULT_RETRIES:      3,
  DEFAULT_RETRY_DELAY:  2_000,
  MAX_RETRY_DELAY:      30_000,
  RETRY_BACKOFF:        2,
});

// ─────────────────────────────────────────────────────────────────────────────
// Telegram
// ─────────────────────────────────────────────────────────────────────────────

export const TELEGRAM = Object.freeze({
  MAX_MESSAGE_LENGTH:       4_096,   // символов
  // Flood control: не более 1 сообщения в секунду боту, 20 сообщений/мин в чат
  MIN_SEND_INTERVAL_MS:     1_000,
  GROUP_RATE_LIMIT_PER_MIN: 20,
  // Коды ошибок, при которых НЕ нужно делать retry
  NO_RETRY_CODES:           [400, 401, 403, 404],
  // Код flood control (нужно ждать retry_after секунд)
  FLOOD_CONTROL_CODE:       429,
});

// ─────────────────────────────────────────────────────────────────────────────
// Планировщик
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEDULER = Object.freeze({
  DEFAULT_CRON:        '0 7 * * *',
  DEFAULT_TIMEZONE:    'Europe/Amsterdam',
  // Максимальное время выполнения одного запуска (защита от зависания)
  MAX_JOB_DURATION_MS: 5 * 60 * 1_000,   // 5 минут
  // Lock TTL — если lock старше этого, считаем его устаревшим
  LOCK_TTL_MS:         10 * 60 * 1_000,  // 10 минут
});

// ─────────────────────────────────────────────────────────────────────────────
// Health Server
// ─────────────────────────────────────────────────────────────────────────────

export const HEALTH = Object.freeze({
  DEFAULT_PORT:    3000,
  PATH_HEALTH:     '/health',
  PATH_METRICS:    '/metrics',
  PATH_READY:      '/ready',
});

// ─────────────────────────────────────────────────────────────────────────────
// Логирование
// ─────────────────────────────────────────────────────────────────────────────

export const LOGGING = Object.freeze({
  DEFAULT_LEVEL:   'info',
  MAX_FILES:       '14d',        // хранить 14 дней
  MAX_SIZE:        '20m',        // ротация при 20 MB
  DATE_PATTERN:    'YYYY-MM-DD',
  LOGS_DIR:        'logs',
});

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

export const STATE = Object.freeze({
  DIR:               'state',
  FILE:              'state/app-state.json',
  LOCK_FILE:         'state/scheduler.lock',
  WRITE_DEBOUNCE_MS: 500,
});

// ─────────────────────────────────────────────────────────────────────────────
// Валидация символов
// ─────────────────────────────────────────────────────────────────────────────

export const SYMBOL = Object.freeze({
  // Регулярные выражения для разных типов символов
  PATTERNS: {
    CRYPTO:    /^[A-Z]{2,10}\/[A-Z]{2,10}$/,              // BTC/USD
    FOREX:     /^[A-Z]{3}\/[A-Z]{3}$/,                    // EUR/USD
    COMMODITY: /^[A-Z]{2,6}\/[A-Z]{2,4}$/,               // XAU/USD
    FUTURES:   /^[A-Z]{1,6}=[A-Z]$/,                      // BZ=F
    INDEX:     /^[A-Z0-9]{2,10}(?::[A-Z]{2,6})?$/,       // SPX, IMOEX:MOEX
  },
  MAX_LENGTH: 20,
});

// ─────────────────────────────────────────────────────────────────────────────
// Exit codes
// ─────────────────────────────────────────────────────────────────────────────

export const EXIT_CODES = Object.freeze({
  SUCCESS:          0,
  UNCAUGHT_ERROR:   1,
  CONFIG_ERROR:     2,
  RESOURCE_ERROR:   3,
  SIGNAL_TERMINATE: 128 + 15,  // SIGTERM
  SIGNAL_INTERRUPT: 128 + 2,   // SIGINT
});
