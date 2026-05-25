/**
 * config/index.js
 *
 * Централизованная конфигурация приложения.
 * Загружает переменные окружения из .env и валидирует обязательные параметры.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Re-export INSTRUMENTS для обратной совместимости
export { INSTRUMENTS } from './instruments.js';

// Загружаем .env из корня проекта
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/**
 * Получает обязательную переменную окружения.
 * Если переменная не задана — выбрасывает ошибку при старте.
 * @param {string} name - Имя переменной
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.includes('your_') || value.includes('_here')) {
    throw new Error(
      `\n❌ Отсутствует обязательная переменная окружения: ${name}\n` +
      `   Скопируйте .env.example в .env и заполните все значения.\n` +
      `   Документация: README.md`
    );
  }
  return value.trim();
}

/**
 * Получает необязательную переменную окружения с дефолтным значением.
 * @param {string} name - Имя переменной
 * @param {string} defaultValue - Значение по умолчанию
 * @returns {string}
 */
function optionalEnv(name, defaultValue) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : defaultValue;
}

// Инструменты вынесены в отдельный файл (без зависимости от env)
// и реэкспортируются выше через: export { INSTRUMENTS } from './instruments.js'

// ─────────────────────────────────────────────────────────────────────────────
// Основная конфигурация
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    chatId: requireEnv('TELEGRAM_CHAT_ID'),
  },

  twelveData: {
    apiKey: requireEnv('TWELVE_DATA_API_KEY'),
    baseUrl: 'https://api.twelvedata.com',
    timeout: parseInt(optionalEnv('API_TIMEOUT_MS', '15000'), 10),
    retries: parseInt(optionalEnv('API_RETRIES', '3'), 10),
    retryDelay: parseInt(optionalEnv('API_RETRY_DELAY_MS', '2000'), 10),
  },

  schedule: {
    // Cron-выражение: "0 7 * * *" = каждый день в 07:00
    cronExpression: optionalEnv('CRON_EXPRESSION', '0 7 * * *'),
    // Временная зона: CET/CEST (Europe/Amsterdam)
    timezone: 'Europe/Amsterdam',
    // Запустить немедленно при старте (для тестирования)
    runOnStart: optionalEnv('RUN_ON_START', 'false') === 'true',
  },

  logging: {
    level: optionalEnv('LOG_LEVEL', 'info'),
  },

  app: {
    nodeEnv: optionalEnv('NODE_ENV', 'production'),
    version: '1.0.0',
  },
};
