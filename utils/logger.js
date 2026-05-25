/**
 * utils/logger.js
 *
 * Winston-логгер с:
 * - Автоматической ротацией файлов (ежедневно + по размеру)
 * - Отдельным файлом для ошибок (error.log)
 * - Correlation ID в каждой записи (через AsyncLocalStorage)
 * - JSON-формат в файлах, читаемый формат в консоли
 * - Поддержкой уровней: debug | info | warn | error
 *
 * Документация Winston: https://github.com/winstonjs/winston
 * Ротация файлов: https://github.com/winstonjs/winston-daily-rotate-file
 */

import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCorrelationId } from './correlationId.js';
import { LOGGING } from '../config/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '..', LOGGING.LOGS_DIR);

// ─────────────────────────────────────────────────────────────────────────────
// Форматы
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Добавляет correlation ID к каждой записи лога.
 */
const addCorrelationId = winston.format((info) => {
  info.correlationId = getCorrelationId();
  return info;
});

/**
 * JSON-формат для файлов: компактный, машиночитаемый.
 */
const fileFormat = winston.format.combine(
  addCorrelationId(),
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Читаемый формат для консоли с цветами.
 */
const consoleFormat = winston.format.combine(
  addCorrelationId(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ level: true }),
  winston.format.printf(({ timestamp, level, message, correlationId, stack, ...meta }) => {
    const cid = correlationId && correlationId !== 'no-ctx'
      ? ` \x1b[90m[${correlationId}]\x1b[0m`
      : '';
    const metaStr = Object.keys(meta).length
      ? ` \x1b[90m${JSON.stringify(meta, null, 0)}\x1b[0m`
      : '';
    const stackStr = stack ? `\n\x1b[31m${stack}\x1b[0m` : '';
    return `\x1b[90m${timestamp}\x1b[0m ${level}${cid} ${message}${metaStr}${stackStr}`;
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Транспорты
// ─────────────────────────────────────────────────────────────────────────────

const level = process.env.LOG_LEVEL || LOGGING.DEFAULT_LEVEL;

const transports = [
  // Консоль
  new winston.transports.Console({
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true,
  }),

  // Все логи → logs/app-YYYY-MM-DD.log
  new winston.transports.DailyRotateFile({
    dirname:      LOGS_DIR,
    filename:     'app-%DATE%.log',
    datePattern:  LOGGING.DATE_PATTERN,
    maxFiles:     LOGGING.MAX_FILES,
    maxSize:      LOGGING.MAX_SIZE,
    format:       fileFormat,
    auditFile:    path.join(LOGS_DIR, '.audit-app.json'),
    handleExceptions: false,
  }),

  // Только ошибки → logs/error-YYYY-MM-DD.log
  new winston.transports.DailyRotateFile({
    dirname:      LOGS_DIR,
    filename:     'error-%DATE%.log',
    datePattern:  LOGGING.DATE_PATTERN,
    maxFiles:     LOGGING.MAX_FILES,
    maxSize:      LOGGING.MAX_SIZE,
    level:        'error',
    format:       fileFormat,
    auditFile:    path.join(LOGS_DIR, '.audit-error.json'),
    handleExceptions: false,
  }),
];

// ─────────────────────────────────────────────────────────────────────────────
// Создание логгера
// ─────────────────────────────────────────────────────────────────────────────

const winstonLogger = winston.createLogger({
  level,
  transports,
  exitOnError: false,   // Не завершать процесс при ошибке логгера
  silent:      false,
});

// ─────────────────────────────────────────────────────────────────────────────
// Публичный интерфейс (обратная совместимость + расширения)
// ─────────────────────────────────────────────────────────────────────────────

export const logger = {
  debug: (message, meta = {}) => winstonLogger.debug(message, meta),
  info:  (message, meta = {}) => winstonLogger.info(message, meta),
  warn:  (message, meta = {}) => winstonLogger.warn(message, meta),
  error: (message, meta = {}) => {
    // Если meta.error — это Error объект, сохраняем stack
    if (meta instanceof Error) {
      winstonLogger.error(message, { error: meta.message, stack: meta.stack });
    } else if (meta?.error instanceof Error) {
      winstonLogger.error(message, { ...meta, errorStack: meta.error.stack, error: meta.error.message });
    } else {
      winstonLogger.error(message, meta);
    }
  },

  /**
   * Визуальный разделитель в консоли.
   * @param {string} [title]
   */
  separator: (title = '') => {
    const line = '─'.repeat(48);
    const msg  = title ? `${line} ${title} ${line}` : line + line;
    winstonLogger.info(msg);
  },

  /**
   * Логирует метрики производительности.
   * @param {string} operation
   * @param {number} latencyMs
   * @param {object} [extra]
   */
  perf: (operation, latencyMs, extra = {}) => {
    winstonLogger.info(`⏱ ${operation}`, { latencyMs, ...extra });
  },

  /**
   * Получить внутренний winston-логгер (для интеграций).
   */
  raw: winstonLogger,
};
