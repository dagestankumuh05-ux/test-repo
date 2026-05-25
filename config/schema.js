/**
 * config/schema.js
 *
 * Zod-схемы для валидации конфигурации и ответов Twelve Data API.
 * Zod обеспечивает runtime-валидацию с точными сообщениями об ошибках.
 *
 * Документация Zod: https://zod.dev
 */

import { z } from 'zod';
import { API, SCHEDULER, HEALTH, LOGGING, TELEGRAM } from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные валидаторы
// ─────────────────────────────────────────────────────────────────────────────

/** Telegram Bot Token: числа:буквы_цифры (минимум 35 символов после :) */
const botTokenSchema = z
  .string()
  .regex(
    /^\d{8,12}:[A-Za-z0-9_-]{35,}$/,
    'Неверный формат TELEGRAM_BOT_TOKEN. Ожидается: 1234567890:ABCdef... (получить у @BotFather)'
  );

/** Telegram Chat ID: числовой ID или @username */
const chatIdSchema = z.union([
  z.string().regex(/^-?\d+$/, 'Chat ID должен быть числом'),
  z.string().regex(/^@[A-Za-z][A-Za-z0-9_]{4,}$/, 'Username должен начинаться с @'),
]);

/** Twelve Data API key: не пустой, минимум 8 символов */
const apiKeySchema = z
  .string()
  .min(8, 'TWELVE_DATA_API_KEY слишком короткий (минимум 8 символов)')
  .regex(/^[A-Za-z0-9_-]+$/, 'TWELVE_DATA_API_KEY содержит недопустимые символы');

/** Cron-выражение: 5 полей */
const cronSchema = z
  .string()
  .regex(
    /^(\*|[0-9*,\-\/]+)\s+(\*|[0-9*,\-\/]+)\s+(\*|[0-9*,\-\/]+)\s+(\*|[0-9*,\-\/]+)\s+(\*|[0-9*,\-\/]+)$/,
    'Неверный формат CRON_EXPRESSION. Пример: "0 7 * * *" (07:00 ежедневно)'
  );

// ─────────────────────────────────────────────────────────────────────────────
// Схема конфигурации приложения
// ─────────────────────────────────────────────────────────────────────────────

export const appConfigSchema = z.object({
  telegram: z.object({
    botToken: botTokenSchema,
    chatId:   chatIdSchema,
  }),

  twelveData: z.object({
    apiKey:     apiKeySchema,
    baseUrl:    z.string().url(),
    timeout:    z.number().int().min(1_000).max(60_000),
    retries:    z.number().int().min(0).max(10),
    retryDelay: z.number().int().min(100).max(30_000),
    dailyQuota: z.number().int().positive(),
  }),

  schedule: z.object({
    cronExpression: cronSchema,
    timezone:       z.string().min(1),
    runOnStart:     z.boolean(),
  }),

  health: z.object({
    enabled: z.boolean(),
    port:    z.number().int().min(1).max(65_535),
  }),

  logging: z.object({
    level:    z.enum(['debug', 'info', 'warn', 'error']),
    maxFiles: z.string(),
    maxSize:  z.string(),
  }),

  app: z.object({
    nodeEnv: z.enum(['development', 'production', 'test']),
    version: z.string(),
  }),
});

/** Тип конфигурации (вывод из схемы) */
export const validateConfig = (raw) => {
  const result = appConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `  • ${path}: ${issue.message}`;
    });

    throw new Error(
      `❌ Ошибка конфигурации (${issues.length} проблем):\n${issues.join('\n')}\n\n` +
      `  Проверьте файл .env (шаблон: .env.example)`
    );
  }

  return result.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// Схемы ответов Twelve Data API
// ─────────────────────────────────────────────────────────────────────────────

/** Числовая строка ("42500.00000" или число) */
const numericString = z.union([
  z.string().regex(/^-?\d+\.?\d*$/, 'Ожидается числовое значение'),
  z.number(),
]);

/** Схема одной котировки (quote object) */
export const quoteSchema = z.object({
  symbol:          z.string().min(1),
  close:           numericString,
  percent_change:  numericString,
  previous_close:  numericString.optional().nullable(),
  change:          numericString.optional().nullable(),
  open:            numericString.optional(),
  high:            numericString.optional(),
  low:             numericString.optional(),
  datetime:        z.string().optional().nullable(),
  is_market_open:  z.boolean().optional().nullable(),
  name:            z.string().optional(),
  exchange:        z.string().optional(),
});

/** Схема ошибки на уровне символа */
export const apiErrorSchema = z.object({
  code:    z.number(),
  message: z.string(),
  status:  z.literal('error'),
});

/** Схема batch-ответа от /quote?symbol=A,B,C */
export const batchQuoteResponseSchema = z.record(
  z.string(),
  z.union([quoteSchema, apiErrorSchema])
);

/**
 * Валидирует одну котировку.
 * @param {unknown} data - Сырые данные
 * @param {string}  symbol - Символ (для сообщения об ошибке)
 * @returns {{ success: true, data: Quote } | { success: false, error: string }}
 */
export function validateQuote(data, symbol) {
  // Сначала проверяем на ошибку API
  const errResult = apiErrorSchema.safeParse(data);
  if (errResult.success) {
    return { success: false, error: `API error ${errResult.data.code}: ${errResult.data.message}` };
  }

  const result = quoteSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { success: false, error: `Схема невалидна для ${symbol}: ${issues}` };
  }

  return { success: true, data: result.data };
}

/**
 * Валидирует batch-ответ API.
 * Возвращает словарь валидных котировок + список ошибок.
 *
 * @param {unknown} data
 * @returns {{ valid: Record<string, Quote>, errors: Record<string, string> }}
 */
export function validateBatchResponse(data) {
  const valid = {};
  const errors = {};

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid, errors: { _root: `Ожидался объект, получено: ${typeof data}` } };
  }

  for (const [symbol, quoteData] of Object.entries(data)) {
    const result = validateQuote(quoteData, symbol);
    if (result.success) {
      valid[symbol] = result.data;
    } else {
      errors[symbol] = result.error;
    }
  }

  return { valid, errors };
}
