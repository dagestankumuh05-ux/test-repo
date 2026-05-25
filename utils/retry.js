/**
 * utils/retry.js
 *
 * Утилита для повторных попыток асинхронных операций
 * с экспоненциальной задержкой (exponential backoff).
 *
 * Использование:
 *   const data = await withRetry(() => fetchSomething(), { retries: 3, delay: 1000 });
 */

import { logger } from './logger.js';

/**
 * Задержка на указанное количество миллисекунд.
 * @param {number} ms - Время ожидания в мс
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Выполняет асинхронную функцию с автоматическими повторными попытками.
 *
 * @param {Function} fn        - Асинхронная функция для выполнения
 * @param {object}   [options] - Параметры повторных попыток
 * @param {number}   [options.retries=3]      - Максимальное число повторов
 * @param {number}   [options.delay=1000]     - Начальная задержка в мс
 * @param {number}   [options.backoff=2]      - Множитель задержки (экспоненциальный рост)
 * @param {number}   [options.maxDelay=30000] - Максимальная задержка в мс
 * @param {string}   [options.label='']       - Метка для логов
 * @param {Function} [options.shouldRetry]    - Функция: error => boolean (стоит ли повторять)
 * @returns {Promise<*>} - Результат успешного выполнения fn
 * @throws {Error} - Бросает последнюю ошибку если все попытки исчерпаны
 */
export async function withRetry(fn, options = {}) {
  const {
    retries = 3,
    delay = 1000,
    backoff = 2,
    maxDelay = 30_000,
    label = '',
    shouldRetry = () => true,
  } = options;

  let lastError;
  const tag = label ? `[${label}] ` : '';

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      // Успешное выполнение — возвращаем результат
      return await fn();
    } catch (error) {
      lastError = error;

      // Проверяем, нужно ли повторять при этой ошибке
      if (!shouldRetry(error)) {
        logger.warn(`${tag}Повтор пропущен (ошибка не позволяет retry): ${error.message}`);
        throw error;
      }

      // Последняя попытка — не ждём, сразу выбрасываем
      if (attempt > retries) {
        logger.error(`${tag}Все ${retries + 1} попытки исчерпаны. Последняя ошибка: ${error.message}`);
        break;
      }

      // Вычисляем задержку: delay * backoff^(attempt-1), но не больше maxDelay
      const waitMs = Math.min(delay * Math.pow(backoff, attempt - 1), maxDelay);

      logger.warn(
        `${tag}Попытка ${attempt}/${retries + 1} не удалась. ` +
        `Следующая попытка через ${waitMs}ms...`,
        { error: error.message }
      );

      await sleep(waitMs);
    }
  }

  throw lastError;
}

/**
 * Выполняет несколько функций параллельно, каждая с retry-логикой.
 * Возвращает массив результатов (null для неудачных).
 *
 * @param {Array<{fn: Function, label: string}>} tasks - Задачи для выполнения
 * @param {object} retryOptions - Параметры retry (применяются ко всем задачам)
 * @returns {Promise<Array<*|null>>}
 */
export async function withRetryParallel(tasks, retryOptions = {}) {
  const results = await Promise.allSettled(
    tasks.map(({ fn, label }) =>
      withRetry(fn, { ...retryOptions, label })
    )
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    logger.error(`Задача "${tasks[i].label}" провалилась окончательно`, {
      error: result.reason?.message,
    });
    return null;
  });
}
