/**
 * utils/retry.js
 * Утилиты для повторных попыток запросов и обёртки fetch с таймаутом.
 */

import { logger } from './logger.js';
import { config } from '../config/config.js';

/**
 * Выполнить async-функцию с автоматическим retry и exponential backoff.
 *
 * @param {Function} fn          — async-функция для выполнения
 * @param {object}   [options]
 * @param {number}   [options.attempts]   — максимум попыток (default из config)
 * @param {number}   [options.baseDelay]  — начальная задержка мс (удваивается)
 * @param {string}   [options.context]    — имя для логов
 * @returns {Promise<*>}
 */
export async function withRetry(fn, options = {}) {
  const attempts  = options.attempts  ?? config.http.retryAttempts;
  const baseDelay = options.baseDelay ?? config.http.retryBaseDelay;
  const context   = options.context   ?? 'withRetry';

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // 1s → 2s → 4s
        logger.warn(`[${context}] Попытка ${attempt}/${attempts} не удалась, повтор через ${delay}мс`, {
          error: error.message,
        });
        await sleep(delay);
      } else {
        logger.error(`[${context}] Все ${attempts} попытки исчерпаны`, {
          error: error.message,
        });
      }
    }
  }

  throw lastError;
}

/**
 * fetch с таймаутом через AbortController.
 *
 * @param {string}  url
 * @param {object}  [options]    — стандартные fetch-опции
 * @param {number}  [timeoutMs]  — таймаут в мс (default из config)
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const timeout = timeoutMs ?? config.http.timeoutMs;
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    // Переименовать AbortError в более понятное сообщение
    if (error.name === 'AbortError') {
      throw new Error(`Таймаут запроса (${timeout}мс): ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Задержка (sleep).
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * fetch + retry в одном вызове.
 *
 * @param {string}  url
 * @param {object}  [fetchOptions]
 * @param {object}  [retryOptions]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, fetchOptions = {}, retryOptions = {}) {
  return withRetry(
    () => fetchWithTimeout(url, fetchOptions),
    { context: new URL(url).hostname, ...retryOptions }
  );
}
