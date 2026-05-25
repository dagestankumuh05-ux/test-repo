/**
 * core/processManager.js
 *
 * Централизованное управление жизненным циклом процесса.
 *
 * Обеспечивает:
 * - Graceful shutdown по SIGTERM / SIGINT
 * - Обработку uncaughtException / unhandledRejection
 * - Безопасное завершение с корректными exit-кодами
 * - Таймаут принудительного завершения (force kill)
 * - Очередь teardown-задач для сервисов
 */

import { logger } from '../utils/logger.js';
import { EXIT_CODES } from '../config/constants.js';

/** Максимальное время ожидания graceful shutdown перед force kill */
const SHUTDOWN_TIMEOUT_MS = 10_000;

export class ProcessManager {
  #isShuttingDown = false;
  #teardownTasks  = [];

  /**
   * Регистрирует сигнальные обработчики.
   * Вызывать один раз при старте приложения.
   */
  install() {
    // ── Нормальное завершение ──────────────────────────────────────────────
    process.on('SIGTERM', () => this.#shutdown('SIGTERM', EXIT_CODES.SIGNAL_TERMINATE));
    process.on('SIGINT',  () => this.#shutdown('SIGINT',  EXIT_CODES.SIGNAL_INTERRUPT));

    // ── Необработанные исключения ──────────────────────────────────────────
    process.on('uncaughtException', (error, origin) => {
      logger.error('💥 uncaughtException — завершение процесса', {
        error:  error.message,
        origin,
        stack:  error.stack,
      });
      // При uncaughtException состояние процесса может быть нарушено
      // PM2/Docker перезапустит процесс автоматически
      this.#forceExit(EXIT_CODES.UNCAUGHT_ERROR, 1_000);
    });

    // ── Необработанные Promise rejections ─────────────────────────────────
    process.on('unhandledRejection', (reason, promise) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack   = reason instanceof Error ? reason.stack   : undefined;
      logger.error('⚠️  unhandledRejection', { message, stack });
      // Не завершаем процесс — это не всегда фатально
      // Но счётчик в метриках увеличивается
    });

    logger.debug('ProcessManager: signal handlers installed');
    return this;
  }

  /**
   * Регистрирует задачу для выполнения при shutdown.
   * Задачи выполняются в порядке регистрации.
   *
   * @param {string}   name - Человекочитаемое имя (для логов)
   * @param {Function} fn   - Async-функция () => Promise<void>
   */
  onShutdown(name, fn) {
    this.#teardownTasks.push({ name, fn });
    return this;
  }

  /**
   * Регистрирует DI-контейнер — все его сервисы получат teardown.
   * @param {import('./container.js').Container} container
   */
  registerContainer(container) {
    this.onShutdown('container.teardown', () => container.teardown());
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────────

  async #shutdown(signal, exitCode) {
    if (this.#isShuttingDown) {
      logger.warn(`Повторный сигнал ${signal} — игнорируем`);
      return;
    }
    this.#isShuttingDown = true;

    logger.info(`\n📴 Получен ${signal}. Graceful shutdown...`);

    // Принудительный kill через SHUTDOWN_TIMEOUT_MS если не успели завершиться
    const forceTimer = setTimeout(() => {
      logger.error(`⏰ Таймаут graceful shutdown (${SHUTDOWN_TIMEOUT_MS}ms). Force exit.`);
      process.exit(exitCode);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref(); // Не держать event loop

    try {
      // Выполняем teardown-задачи последовательно
      for (const { name, fn } of this.#teardownTasks) {
        try {
          logger.debug(`Teardown: ${name}`);
          await fn();
        } catch (error) {
          logger.error(`Teardown "${name}" failed`, { error: error.message });
          // Продолжаем shutdown даже если одна задача упала
        }
      }

      clearTimeout(forceTimer);
      logger.info('👋 Shutdown complete');
      process.exit(exitCode);
    } catch (error) {
      logger.error('Ошибка при shutdown', { error: error.message });
      process.exit(EXIT_CODES.UNCAUGHT_ERROR);
    }
  }

  #forceExit(code, delayMs = 0) {
    if (delayMs > 0) {
      setTimeout(() => process.exit(code), delayMs);
    } else {
      process.exit(code);
    }
  }
}
