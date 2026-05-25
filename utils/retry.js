/**
 * utils/retry.js
 *
 * Retry с exponential backoff + correlation ID в логах.
 * Поддерживает jitter для предотвращения thundering herd.
 */

import { logger } from './logger.js';
import { API } from '../config/constants.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Добавляет случайный jitter к задержке (±25%).
 * Предотвращает одновременный retry нескольких инстансов.
 */
function jitter(ms) {
  return ms * (0.75 + Math.random() * 0.5);
}

/**
 * Выполняет async-функцию с retry и exponential backoff.
 *
 * @param {Function} fn          - Async-функция для выполнения
 * @param {object}  [opts]
 * @param {number}  [opts.retries=3]
 * @param {number}  [opts.delay=2000]       - Начальная задержка (мс)
 * @param {number}  [opts.backoff=2]        - Множитель задержки
 * @param {number}  [opts.maxDelay=30000]   - Максимальная задержка
 * @param {boolean} [opts.useJitter=true]   - Добавлять jitter к задержке
 * @param {string}  [opts.label='']         - Метка для логов
 * @param {Function}[opts.shouldRetry]      - (error) => boolean
 * @param {Function}[opts.onRetry]          - (attempt, error) => void
 * @returns {Promise<*>}
 */
export async function withRetry(fn, opts = {}) {
  const {
    retries     = API.DEFAULT_RETRIES,
    delay       = API.DEFAULT_RETRY_DELAY,
    backoff     = API.RETRY_BACKOFF,
    maxDelay    = API.MAX_RETRY_DELAY,
    useJitter   = true,
    label       = '',
    shouldRetry = () => true,
    onRetry     = null,
  } = opts;

  const tag = label ? `[${label}] ` : '';
  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Не повторять если shouldRetry вернул false
      if (!shouldRetry(error)) {
        logger.debug(`${tag}Retry пропущен (shouldRetry=false)`, { error: error.message });
        throw error;
      }

      // Последняя попытка — не ждать
      if (attempt > retries) {
        logger.error(`${tag}Все попытки исчерпаны (${retries + 1}/${retries + 1})`, {
          error: error.message,
        });
        break;
      }

      // Вычисляем задержку
      let waitMs = Math.min(delay * Math.pow(backoff, attempt - 1), maxDelay);
      if (useJitter) waitMs = Math.round(jitter(waitMs));

      logger.warn(
        `${tag}Попытка ${attempt}/${retries + 1} не удалась. Повтор через ${waitMs}ms`,
        { error: error.message }
      );

      if (onRetry) onRetry(attempt, error);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

/**
 * Выполняет набор задач параллельно, каждую с retry.
 * Возвращает массив результатов (null для провалившихся).
 *
 * @param {Array<{ fn: Function, label: string }>} tasks
 * @param {object} [retryOpts]
 * @returns {Promise<Array<*|null>>}
 */
export async function withRetryParallel(tasks, retryOpts = {}) {
  const settled = await Promise.allSettled(
    tasks.map(({ fn, label }) => withRetry(fn, { ...retryOpts, label }))
  );

  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    logger.error(`Задача "${tasks[i].label}" провалилась`, { error: result.reason?.message });
    return null;
  });
}
