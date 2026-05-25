/**
 * config/index.js
 *
 * Централизованная конфигурация с Zod-валидацией.
 * Загружает .env, парсит значения, валидирует схему.
 *
 * При невалидной конфигурации — детальная ошибка с указанием проблемных полей.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { validateConfig } from './schema.js';
import { API, SCHEDULER, HEALTH, LOGGING } from './constants.js';

// Re-export для удобства
export { INSTRUMENTS } from './instruments.js';
export { API, SCHEDULER, HEALTH, LOGGING, TELEGRAM, STATE, EXIT_CODES, SYMBOL } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Загружаем .env из корня проекта (не бросаем ошибку если файл отсутствует —
// в production переменные могут приходить из окружения системы/Docker)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции чтения env
// ─────────────────────────────────────────────────────────────────────────────

function env(name, fallback = undefined) {
  const v = process.env[name];
  if (!v || v.trim() === '' || v.includes('_here') || v.includes('your_')) {
    return fallback;
  }
  return v.trim();
}

function envInt(name, fallback) {
  const v = env(name);
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function envBool(name, fallback = false) {
  const v = env(name);
  if (v === undefined) return fallback;
  return v.toLowerCase() === 'true';
}

// ─────────────────────────────────────────────────────────────────────────────
// Сборка и валидация конфигурации
// ─────────────────────────────────────────────────────────────────────────────

const raw = {
  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN'),
    chatId:   env('TELEGRAM_CHAT_ID'),
  },

  twelveData: {
    apiKey:     env('TWELVE_DATA_API_KEY'),
    baseUrl:    env('TWELVE_DATA_BASE_URL', API.TWELVE_DATA_BASE_URL),
    timeout:    envInt('API_TIMEOUT_MS',    API.DEFAULT_TIMEOUT_MS),
    retries:    envInt('API_RETRIES',       API.DEFAULT_RETRIES),
    retryDelay: envInt('API_RETRY_DELAY_MS', API.DEFAULT_RETRY_DELAY),
    dailyQuota: envInt('API_DAILY_QUOTA',   API.QUOTA_DAILY_FREE),
  },

  schedule: {
    cronExpression: env('CRON_EXPRESSION', SCHEDULER.DEFAULT_CRON),
    timezone:       env('TZ_CRON',         SCHEDULER.DEFAULT_TIMEZONE),
    runOnStart:     envBool('RUN_ON_START', false),
  },

  health: {
    enabled: envBool('HEALTH_ENABLED', true),
    port:    envInt('HEALTH_PORT',    HEALTH.DEFAULT_PORT),
  },

  logging: {
    level:    env('LOG_LEVEL',      LOGGING.DEFAULT_LEVEL),
    maxFiles: env('LOG_MAX_FILES',  LOGGING.MAX_FILES),
    maxSize:  env('LOG_MAX_SIZE',   LOGGING.MAX_SIZE),
  },

  app: {
    nodeEnv: env('NODE_ENV', 'production'),
    version: '2.0.0',
  },
};

// Валидируем через Zod (бросает Error при невалидных значениях)
export const config = validateConfig(raw);
