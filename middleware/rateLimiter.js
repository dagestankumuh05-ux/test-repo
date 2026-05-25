/**
 * middleware/rateLimiter.js
 *
 * Защита от превышения лимитов Telegram Bot API.
 *
 * Telegram лимиты:
 * - Не более 30 сообщений/сек для одного бота (все чаты)
 * - Не более 20 сообщений/мин в одну группу
 * - При превышении: HTTP 429 с полем retry_after (секунды)
 *
 * Стратегия:
 * - Минимальный интервал между сообщениями (1000ms по умолчанию)
 * - При получении 429 — ожидание retry_after + jitter
 * - Трекинг отправок в окне 1 минуты
 */

import { logger } from '../utils/logger.js';
import { TELEGRAM } from '../config/constants.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TelegramRateLimiter {
  #lastSentAt   = 0;          // timestamp последней отправки
  #sentTimings  = [];         // timestamp'ы отправок за последнюю минуту
  #floodWaitUntil = 0;        // timestamp до которого нельзя слать (flood control)

  /**
   * Ожидает перед отправкой если нужно соблюсти rate limit.
   * Вызывать ПЕРЕД каждым вызовом Telegram API.
   *
   * @returns {Promise<void>}
   */
  async throttle() {
    const now = Date.now();

    // Ждём если получили flood control от Telegram
    if (now < this.#floodWaitUntil) {
      const waitMs = this.#floodWaitUntil - now;
      logger.warn(`Telegram flood control: waiting ${waitMs}ms before next send`);
      await sleep(waitMs);
    }

    // Минимальный интервал между сообщениями
    const sinceLastMs = Date.now() - this.#lastSentAt;
    if (sinceLastMs < TELEGRAM.MIN_SEND_INTERVAL_MS) {
      const waitMs = TELEGRAM.MIN_SEND_INTERVAL_MS - sinceLastMs;
      logger.debug(`Rate limiter: throttling for ${waitMs}ms`);
      await sleep(waitMs);
    }

    // Проверяем лимит 20 сообщений/мин для групп
    this.#cleanOldTimings();
    if (this.#sentTimings.length >= TELEGRAM.GROUP_RATE_LIMIT_PER_MIN) {
      // Ждём пока самое старое сообщение выйдет из окна
      const oldest   = this.#sentTimings[0];
      const waitMs   = Math.max(0, oldest + 60_000 - Date.now()) + 100;
      logger.warn(`Telegram per-minute rate limit: waiting ${waitMs}ms`, {
        sentInLastMinute: this.#sentTimings.length,
        limit:            TELEGRAM.GROUP_RATE_LIMIT_PER_MIN,
      });
      await sleep(waitMs);
    }

    this.#lastSentAt = Date.now();
    this.#sentTimings.push(this.#lastSentAt);
  }

  /**
   * Вызывать когда Telegram API вернул 429.
   * Устанавливает время ожидания по retry_after из ответа.
   *
   * @param {number} retryAfterSeconds - Значение поля retry_after из Telegram API
   */
  onFloodControl(retryAfterSeconds) {
    const waitMs = (retryAfterSeconds + 1) * 1_000; // +1 секунда jitter
    this.#floodWaitUntil = Date.now() + waitMs;
    logger.warn(`Telegram flood control received: waiting ${retryAfterSeconds}s`, {
      retryAfter:     retryAfterSeconds,
      waitUntil:      new Date(this.#floodWaitUntil).toISOString(),
    });
  }

  /** Удаляет записи старше 60 секунд из #sentTimings */
  #cleanOldTimings() {
    const cutoff = Date.now() - 60_000;
    this.#sentTimings = this.#sentTimings.filter((t) => t > cutoff);
  }

  /** Возвращает статистику использования */
  getStats() {
    this.#cleanOldTimings();
    return {
      sentInLastMinute: this.#sentTimings.length,
      minuteLimit:      TELEGRAM.GROUP_RATE_LIMIT_PER_MIN,
      isFloodLimited:   Date.now() < this.#floodWaitUntil,
      floodWaitMs:      Math.max(0, this.#floodWaitUntil - Date.now()),
    };
  }
}
