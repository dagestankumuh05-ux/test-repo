/**
 * services/schedulerService.js
 *
 * Планировщик с защитой от дублирования выполнения.
 *
 * Гарантии:
 * - Singleton lock: второй запуск не начнётся пока первый не завершился
 * - Автоматическое определение timezone (Europe/Amsterdam = CET/CEST)
 * - Метрики продолжительности каждого запуска
 * - Correlation ID для трассировки каждого запуска
 * - Graceful shutdown: текущий запуск может завершиться перед остановкой
 */

import cron from 'node-cron';
import { config }             from '../config/index.js';
import { logger }             from '../utils/logger.js';
import { runWithId, generateCronId } from '../utils/correlationId.js';
import { SCHEDULER }          from '../config/constants.js';

export class SchedulerService {
  #task     = null;    // node-cron task
  #metrics  = null;    // MetricsService
  #state    = null;    // StateService
  #market   = null;    // MarketService
  #telegram = null;    // TelegramService
  #isRunning = false;  // Флаг текущего выполнения

  /**
   * @param {object} deps
   * @param {import('./marketService.js').MarketService}     deps.market
   * @param {import('./telegramService.js').TelegramService} deps.telegram
   * @param {import('./metricsService.js').MetricsService}   deps.metrics
   * @param {import('./stateService.js').StateService}       deps.state
   */
  constructor(deps) {
    this.#market   = deps.market;
    this.#telegram = deps.telegram;
    this.#metrics  = deps.metrics;
    this.#state    = deps.state;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Запуск задачи
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Выполняет один цикл рыночной сводки.
   * Защищён от параллельного выполнения через:
   * 1. In-memory флаг this.#isRunning
   * 2. Persistent lock в StateService (защита от перезапуска процесса)
   *
   * @param {object} [opts]
   * @param {boolean} [opts.force]  - Пропустить lock-проверку (для тестов)
   * @returns {Promise<void>}
   */
  async runJob(opts = {}) {
    const correlationId = generateCronId();

    await runWithId(correlationId, async () => {
      const startMs = Date.now();

      // ── In-memory lock ─────────────────────────────────────────────────
      if (this.#isRunning && !opts.force) {
        logger.warn('Job already running in this process (in-memory lock). Skipping.', {
          correlationId,
        });
        return;
      }

      // ── Persistent lock ────────────────────────────────────────────────
      if (!opts.force && this.#state) {
        const acquired = this.#state.acquireLock(correlationId);
        if (!acquired) {
          logger.warn('Job is locked by another execution. Skipping.', { correlationId });
          return;
        }
      }

      this.#isRunning = true;
      this.#metrics?.increment('cron.executions');
      this.#metrics?.setGauge('cron.lastRunAt', new Date().toISOString());

      logger.separator(`CRON JOB START [${correlationId}]`);
      logger.info('⏰ Запуск ежедневной рыночной сводки');

      try {
        // Шаг 1: Получить данные
        const marketData = await this.#market.fetchMarketData();

        // Шаг 2: Отправить в Telegram
        const result = await this.#telegram.sendMarketBriefing(marketData);

        const duration = Date.now() - startMs;
        this.#metrics?.recordLatency('cron.duration', duration);
        this.#metrics?.setGauge('cron.lastDurationMs', duration);

        if (result.sent) {
          logger.info(`✅ Сводка отправлена за ${duration}ms`, {
            messageId: result.messageId,
            duration,
          });
        } else {
          logger.info(`⏭  Сводка пропущена (${result.reason}) за ${duration}ms`);
        }
      } catch (error) {
        this.#metrics?.increment('cron.failures');
        const duration = Date.now() - startMs;
        logger.error(`❌ Ошибка при выполнении cron-задачи (${duration}ms)`, {
          error: error.message,
          stack: error.stack,
        });
      } finally {
        this.#isRunning = false;
        if (!opts.force) this.#state?.releaseLock();

        // Логируем использование памяти после каждого запуска
        this.#metrics?.logMemoryUsage();
        logger.separator(`CRON JOB END [${correlationId}]`);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Управление планировщиком
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Запускает cron-планировщик.
   * @returns {this}
   */
  start() {
    const { cronExpression, timezone, runOnStart } = config.schedule;

    // Валидация cron-выражения
    if (!cron.validate(cronExpression)) {
      throw new Error(
        `Неверное cron-выражение: "${cronExpression}"\n` +
        `Пример: "0 7 * * *" (ежедневно в 07:00)\n` +
        `Проверка: https://crontab.guru/`
      );
    }

    logger.info('Инициализация планировщика', {
      cron:        cronExpression,
      timezone,
      runOnStart,
    });

    // Вычисляем и логируем следующий запуск
    this.#logNextRun(cronExpression, timezone);

    // Создаём cron-задачу
    this.#task = cron.schedule(
      cronExpression,
      () => {
        // Намеренно не await — cron не ждёт callback
        this.runJob().catch((err) => {
          logger.error('Unhandled error in cron callback', { error: err.message });
        });
      },
      { timezone, scheduled: true }
    );

    logger.info('✅ Планировщик запущен');

    // Немедленный запуск если RUN_ON_START=true
    if (runOnStart) {
      logger.info('🚀 RUN_ON_START=true: запуск немедленно...');
      setTimeout(() => this.runJob({ force: true }), 500);
    }

    return this;
  }

  /**
   * Останавливает cron-планировщик.
   * Если job сейчас выполняется — ждём до MAX_JOB_DURATION_MS.
   * @returns {Promise<void>}
   */
  async stop() {
    logger.info('Остановка планировщика...');

    if (this.#task) {
      this.#task.stop();
      this.#task = null;
    }

    // Ждём завершения текущего job
    if (this.#isRunning) {
      logger.info('Job выполняется, ожидаем завершения...');
      const deadline = Date.now() + SCHEDULER.MAX_JOB_DURATION_MS;

      while (this.#isRunning && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
      }

      if (this.#isRunning) {
        logger.warn('Job не завершился в срок, принудительная остановка');
      }
    }

    logger.info('⏹  Планировщик остановлен');
  }

  async teardown() {
    await this.stop();
  }

  /** Возвращает статус планировщика */
  getStatus() {
    return {
      running:   !!this.#task,
      jobActive: this.#isRunning,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  #logNextRun(cronExpr, timezone) {
    try {
      const [minute, hour] = cronExpr.split(' ').map(Number);
      if (!isNaN(hour) && !isNaN(minute)) {
        const next = new Date();
        next.setHours(hour, minute, 0, 0);
        if (next <= new Date()) next.setDate(next.getDate() + 1);

        const formatted = next.toLocaleString('ru-RU', {
          timeZone: timezone,
          weekday: 'long',
          day:     'numeric',
          month:   'long',
          hour:    '2-digit',
          minute:  '2-digit',
        });
        logger.info(`📅 Следующий запуск: ${formatted} (${timezone})`);
      }
    } catch {
      // Некритично
    }
  }
}
