/**
 * utils/logger.js
 * Winston-логгер с записью в файлы и консоль.
 * - logs/combined.log  — все уровни
 * - logs/error.log     — только ошибки
 * - Консоль            — цветной вывод в dev-режиме
 */

import { createLogger, format, transports } from 'winston';
import { existsSync, mkdirSync } from 'fs';
import { config } from '../config/config.js';

const { combine, timestamp, errors, printf, colorize, json } = format;

// ─── Создать папку logs если нет ─────────────────────────────────────────────
if (!existsSync(config.logging.dir)) {
  mkdirSync(config.logging.dir, { recursive: true });
}

// ─── Формат для консоли ───────────────────────────────────────────────────────
const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length
    ? '\n  ' + JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')
    : '';
  const errorStr = stack ? `\n${stack}` : '';
  return `${timestamp} [${level}] ${message}${errorStr}${metaStr}`;
});

// ─── Создание логгера ─────────────────────────────────────────────────────────
export const logger = createLogger({
  level: config.logging.level,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports: [
    // Консоль — с цветом
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        consoleFormat
      ),
    }),
    // Все логи в файл (JSON для удобства парсинга)
    new transports.File({
      filename: `${config.logging.dir}/combined.log`,
      format: json(),
      maxsize:  10 * 1024 * 1024,  // 10 MB
      maxFiles: config.logging.retentionDays,
      tailable: true,
    }),
    // Только ошибки
    new transports.File({
      filename: `${config.logging.dir}/error.log`,
      level:    'error',
      format:   json(),
      maxsize:  5 * 1024 * 1024,   // 5 MB
      maxFiles: config.logging.retentionDays,
      tailable: true,
    }),
  ],
  // Не падать при необработанных ошибках в самом логгере
  exitOnError: false,
});

// ─── Хелпер: логировать ошибку с контекстом ───────────────────────────────────
export function logError(context, error, extra = {}) {
  logger.error(`[${context}] ${error.message}`, {
    ...extra,
    stack: error.stack,
    name:  error.name,
  });
}
