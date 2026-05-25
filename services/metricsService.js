/**
 * services/metricsService.js
 *
 * In-memory сбор метрик производительности и надёжности.
 *
 * Метрики:
 *   - Счётчики (counters): количество событий
 *   - Латентности (histograms): min/max/avg/p95 в мс
 *   - Gauges: текущее значение (память, аптайм)
 *
 * Совместимость с Redis:
 *   Интерфейс спроектирован так, чтобы при необходимости
 *   можно было заменить Map на Redis INCR/HSET без изменения вызывающего кода.
 *
 * Доступ через /health эндпоинт.
 */

import { logger } from '../utils/logger.js';

export class MetricsService {
  #startTime  = Date.now();
  #counters   = new Map();   // { name: number }
  #latencies  = new Map();   // { name: number[] }
  #gauges     = new Map();   // { name: * }

  // ─────────────────────────────────────────────────────────────────────────
  // Счётчики (monotonic, только увеличиваются)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Увеличивает счётчик на delta (по умолчанию +1).
   * @param {string} name
   * @param {number} [delta=1]
   */
  increment(name, delta = 1) {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + delta);
  }

  /**
   * Возвращает значение счётчика.
   * @param {string} name
   * @returns {number}
   */
  getCounter(name) {
    return this.#counters.get(name) ?? 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Латентности (histogram)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Записывает замер латентности в мс.
   * @param {string} name
   * @param {number} ms
   */
  recordLatency(name, ms) {
    if (!this.#latencies.has(name)) {
      this.#latencies.set(name, []);
    }
    const arr = this.#latencies.get(name);
    arr.push(ms);
    // Хранить только последние 100 замеров (скользящее окно)
    if (arr.length > 100) arr.shift();
  }

  /**
   * Возвращает статистику по латентности.
   * @param {string} name
   * @returns {{ count: number, min: number, max: number, avg: number, p95: number }|null}
   */
  getLatencyStats(name) {
    const arr = this.#latencies.get(name);
    if (!arr || arr.length === 0) return null;

    const sorted = [...arr].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const p95idx = Math.floor(count * 0.95);

    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      avg: Math.round(sum / count),
      p95: sorted[p95idx] ?? sorted[count - 1],
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Gauges (текущее значение, может уменьшаться)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Устанавливает значение gauge.
   * @param {string} name
   * @param {*}      value
   */
  setGauge(name, value) {
    this.#gauges.set(name, value);
  }

  /**
   * Возвращает значение gauge.
   * @param {string} name
   * @returns {*}
   */
  getGauge(name) {
    return this.#gauges.get(name);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Утилита: измерение времени выполнения
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Измеряет время выполнения async-функции и записывает латентность.
   *
   * @param {string}   metricName  - Имя метрики
   * @param {Function} fn          - Async-функция
   * @param {object}   [opts]
   * @param {string}   [opts.successCounter]  - Счётчик для успеха
   * @param {string}   [opts.failureCounter]  - Счётчик для ошибки
   * @returns {Promise<*>}
   */
  async measure(metricName, fn, opts = {}) {
    const start = Date.now();
    const { successCounter, failureCounter } = opts;

    try {
      const result = await fn();
      const ms = Date.now() - start;
      this.recordLatency(metricName, ms);
      if (successCounter) this.increment(successCounter);
      logger.perf(metricName, ms);
      return result;
    } catch (error) {
      const ms = Date.now() - start;
      this.recordLatency(metricName, ms);
      if (failureCounter) this.increment(failureCounter);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Снимок состояния для /health
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Возвращает полный снимок метрик.
   * @returns {object}
   */
  getSnapshot() {
    const uptimeMs     = Date.now() - this.#startTime;
    const uptimeSec    = Math.floor(uptimeMs / 1000);
    const memUsage     = process.memoryUsage();

    // Форматируем память
    const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)}MB`;

    // Собираем все латентности
    const latencies = {};
    for (const [name] of this.#latencies) {
      latencies[name] = this.getLatencyStats(name);
    }

    // Собираем все счётчики
    const counters = Object.fromEntries(this.#counters);

    // Gauges
    const gauges = Object.fromEntries(this.#gauges);

    return {
      uptime: {
        ms:      uptimeMs,
        seconds: uptimeSec,
        human:   formatUptime(uptimeSec),
      },
      memory: {
        heapUsed:  mb(memUsage.heapUsed),
        heapTotal: mb(memUsage.heapTotal),
        rss:       mb(memUsage.rss),
        external:  mb(memUsage.external),
        heapUsedBytes: memUsage.heapUsed,
      },
      counters,
      latencies,
      gauges,
    };
  }

  /**
   * Логирует текущие метрики памяти (вызывается периодически).
   */
  logMemoryUsage() {
    const mem = process.memoryUsage();
    const mb  = (b) => Math.round(b / 1024 / 1024);
    logger.debug('📊 Memory usage', {
      heapUsed:  `${mb(mem.heapUsed)}MB`,
      heapTotal: `${mb(mem.heapTotal)}MB`,
      rss:       `${mb(mem.rss)}MB`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts = [];
  if (d > 0) parts.push(`${d}д`);
  if (h > 0) parts.push(`${h}ч`);
  if (m > 0) parts.push(`${m}м`);
  parts.push(`${s}с`);

  return parts.join(' ');
}
