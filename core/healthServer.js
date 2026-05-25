/**
 * core/healthServer.js
 *
 * Лёгкий HTTP-сервер для health-checks и мониторинга.
 * Не требует Express — использует встроенный Node.js http модуль.
 *
 * Endpoints:
 *   GET /health   — Полный статус: метрики, состояние, память, аптайм
 *   GET /ready    — Проверка готовности (для Kubernetes readiness probe)
 *   GET /metrics  — Только метрики (для Prometheus/Grafana если нужно)
 *
 * Использование:
 *   const server = new HealthServer({ metrics, state, config });
 *   server.start();  // порт берётся из config.health.port
 *   server.stop();   // при shutdown
 */

import http from 'node:http';
import { logger } from '../utils/logger.js';
import { HEALTH } from '../config/constants.js';

export class HealthServer {
  #server   = null;
  #metrics  = null;
  #state    = null;
  #config   = null;
  #port     = HEALTH.DEFAULT_PORT;
  #isReady  = false;

  /**
   * @param {object} deps
   * @param {import('../services/metricsService.js').MetricsService} deps.metrics
   * @param {import('../services/stateService.js').StateService}     deps.state
   * @param {object} deps.config
   */
  constructor(deps) {
    this.#metrics = deps.metrics;
    this.#state   = deps.state;
    this.#config  = deps.config;
    this.#port    = deps.config.health.port;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Request handling
  // ─────────────────────────────────────────────────────────────────────────

  #handleRequest(req, res) {
    const { url, method } = req;

    // Только GET
    if (method !== 'GET') {
      return this.#respond(res, 405, { error: 'Method Not Allowed' });
    }

    try {
      if (url === HEALTH.PATH_HEALTH || url === '/') {
        return this.#handleHealth(res);
      }
      if (url === HEALTH.PATH_READY) {
        return this.#handleReady(res);
      }
      if (url === HEALTH.PATH_METRICS) {
        return this.#handleMetrics(res);
      }
      return this.#respond(res, 404, { error: 'Not Found' });
    } catch (error) {
      logger.error('Health server handler error', { error: error.message });
      return this.#respond(res, 500, { error: 'Internal Server Error' });
    }
  }

  #handleHealth(res) {
    const metricsSnapshot = this.#metrics.getSnapshot();
    const stateSnapshot   = this.#state.getSnapshot();

    const body = {
      status:  'ok',
      version: this.#config.app.version,
      nodeVersion: process.version,
      nodeEnv: this.#config.app.nodeEnv,

      uptime: metricsSnapshot.uptime,
      memory: metricsSnapshot.memory,

      metrics: {
        // Cron
        cronExecutions:  metricsSnapshot.counters['cron.executions']  ?? 0,
        cronFailures:    metricsSnapshot.counters['cron.failures']     ?? 0,
        cronDurations:   metricsSnapshot.latencies['cron.duration'],

        // Twelve Data API
        apiRequests:     metricsSnapshot.counters['api.requests']  ?? 0,
        apiFailures:     metricsSnapshot.counters['api.failures']  ?? 0,
        apiLatency:      metricsSnapshot.latencies['api.latency'],

        // Telegram
        telegramSent:    metricsSnapshot.counters['telegram.sent']     ?? 0,
        telegramFailed:  metricsSnapshot.counters['telegram.failed']   ?? 0,
        telegramLatency: metricsSnapshot.latencies['telegram.latency'],

        // Deduplication
        dedupSkipped:    metricsSnapshot.counters['dedup.skipped']  ?? 0,
      },

      state: {
        lastSentAt:      stateSnapshot.lastSentAt,
        schedulerLocked: stateSnapshot.schedulerLocked,
        apiQuota: {
          used:        stateSnapshot.apiQuota.used,
          dailyLimit:  stateSnapshot.apiQuota.dailyLimit,
          remaining:   stateSnapshot.apiQuota.dailyLimit - stateSnapshot.apiQuota.used,
          resetAt:     stateSnapshot.apiQuota.resetAt,
          usagePercent: stateSnapshot.apiQuota.dailyLimit > 0
            ? `${Math.round((stateSnapshot.apiQuota.used / stateSnapshot.apiQuota.dailyLimit) * 100)}%`
            : '0%',
        },
      },

      schedule: {
        cron:     this.#config.schedule.cronExpression,
        timezone: this.#config.schedule.timezone,
      },
    };

    this.#respond(res, 200, body);
  }

  #handleReady(res) {
    if (this.#isReady) {
      this.#respond(res, 200, { status: 'ready' });
    } else {
      this.#respond(res, 503, { status: 'not ready' });
    }
  }

  #handleMetrics(res) {
    const snapshot = this.#metrics.getSnapshot();
    this.#respond(res, 200, snapshot);
  }

  #respond(res, statusCode, body) {
    const json = JSON.stringify(body, null, 2);
    res.writeHead(statusCode, {
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control':  'no-cache, no-store',
      'X-Powered-By':   'telegram-market-bot',
    });
    res.end(json);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Запускает HTTP-сервер.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this.#server = http.createServer((req, res) => {
        this.#handleRequest(req, res);
      });

      this.#server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`Health server: порт ${this.#port} уже занят. Используйте другой порт (HEALTH_PORT).`);
        } else {
          logger.error('Health server error', { error: error.message });
        }
        reject(error);
      });

      this.#server.listen(this.#port, '0.0.0.0', () => {
        logger.info(`🩺 Health server запущен на порту ${this.#port}`, {
          endpoints: [
            `http://localhost:${this.#port}${HEALTH.PATH_HEALTH}`,
            `http://localhost:${this.#port}${HEALTH.PATH_READY}`,
            `http://localhost:${this.#port}${HEALTH.PATH_METRICS}`,
          ],
        });
        resolve();
      });
    });
  }

  /** Сигнализирует что приложение готово принимать трафик */
  markReady() {
    this.#isReady = true;
    logger.debug('Health server: marked as ready');
  }

  /** Останавливает HTTP-сервер */
  stop() {
    return new Promise((resolve) => {
      if (!this.#server) return resolve();
      this.#server.close(() => {
        logger.debug('Health server stopped');
        resolve();
      });
    });
  }

  teardown() {
    return this.stop();
  }
}
