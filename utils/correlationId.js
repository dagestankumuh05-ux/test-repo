/**
 * utils/correlationId.js
 *
 * Correlation ID для трассировки запросов через все слои приложения.
 *
 * Использует Node.js AsyncLocalStorage для автоматического распространения
 * ID через всю цепочку async/await вызовов — без явной передачи параметров.
 *
 * Использование:
 *   import { runWithId, getCorrelationId } from './correlationId.js';
 *
 *   // При старте задачи:
 *   await runWithId('job-abc123', async () => {
 *     logger.info('Начало');  // автоматически содержит correlationId: 'job-abc123'
 *     await doSomething();    // тоже содержит correlationId
 *   });
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// AsyncLocalStorage хранит correlation ID для текущего async-контекста
const storage = new AsyncLocalStorage();

/**
 * Запускает fn внутри контекста с заданным (или новым) correlation ID.
 * Все вызовы внутри fn, включая вложенные Promise/async, наследуют этот ID.
 *
 * @param {string|null} id  - Correlation ID (или null — будет сгенерирован)
 * @param {Function}    fn  - Async-функция для выполнения
 * @returns {Promise<*>}
 */
export function runWithId(id, fn) {
  const correlationId = id || generateId();
  return storage.run(correlationId, fn);
}

/**
 * Возвращает текущий correlation ID из async-контекста.
 * Возвращает 'no-ctx' если вызван вне runWithId().
 *
 * @returns {string}
 */
export function getCorrelationId() {
  return storage.getStore() ?? 'no-ctx';
}

/**
 * Генерирует короткий correlation ID (8 символов UUID без дефисов).
 * Достаточно уникален для одного процесса.
 *
 * @returns {string} Например: 'a1b2c3d4'
 */
export function generateId() {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

/**
 * Генерирует correlation ID для конкретного cron-запуска.
 * Формат: 'cron-YYYYMMDD-hhmmss'
 *
 * @returns {string} Например: 'cron-20260525-070001'
 */
export function generateCronId() {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 15).replace('.', '');
  return `cron-${date.slice(0, 8)}-${date.slice(8, 14)}`;
}
