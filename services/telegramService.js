/**
 * services/telegramService.js
 *
 * Сервис отправки сообщений через Telegram Bot API.
 *
 * Возможности:
 * - Защита от flood limits (TelegramRateLimiter)
 * - Message deduplication (StateService.isDuplicate)
 * - Retry с shouldRetry (не повторять при 401/403/404)
 * - Автоматическая обработка 429 (flood control от Telegram)
 * - Correlation ID в каждом запросе
 * - Метрики latency/success/failed
 */

import { config }            from '../config/index.js';
import { withRetry }         from '../utils/retry.js';
import { logger }            from '../utils/logger.js';
import { getCorrelationId }  from '../utils/correlationId.js';
import { formatMarketMessage } from '../utils/formatter.js';
import { TelegramRateLimiter } from '../middleware/rateLimiter.js';
import { TELEGRAM }          from '../config/constants.js';

export class TelegramService {
  #token;
  #chatId;
  #limiter;
  #metrics;
  #state;
  #baseUrl;

  /**
   * @param {object} [deps]
   * @param {import('../services/metricsService.js').MetricsService} [deps.metrics]
   * @param {import('../services/stateService.js').StateService}     [deps.state]
   */
  constructor(deps = {}) {
    this.#token   = config.telegram.botToken;
    this.#chatId  = config.telegram.chatId;
    this.#baseUrl = `https://api.telegram.org/bot${this.#token}`;
    this.#limiter = new TelegramRateLimiter();
    this.#metrics = deps.metrics ?? null;
    this.#state   = deps.state   ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: HTTP
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Выполняет запрос к Telegram Bot API.
   * @param {string} method  - Метод API (sendMessage, getMe и т.д.)
   * @param {object} body    - Тело запроса
   * @returns {Promise<object>} - result из ответа Telegram
   */
  async #request(method, body) {
    const url        = `${this.#baseUrl}/${method}`;
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TELEGRAM.MAX_MESSAGE_LENGTH);

    try {
      const response = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'User-Agent':    'TelegramMarketBot/2.0',
          'X-Correlation': getCorrelationId(),
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Telegram API: malformed JSON response (HTTP ${response.status})`);
      }

      if (!data.ok) {
        const err = new Error(`Telegram API [${data.error_code}]: ${data.description}`);
        err.code          = data.error_code;
        err.description   = data.description;
        err.parameters    = data.parameters;  // retry_after при 429
        throw err;
      }

      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public: sendMessage
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Отправляет HTML-сообщение в чат.
   *
   * @param {string} text              - HTML-текст
   * @param {string} [chatId]          - ID чата (по умолчанию из config)
   * @param {object} [extra]           - Дополнительные параметры Telegram API
   * @returns {Promise<object>}
   */
  async sendMessage(text, chatId = this.#chatId, extra = {}) {
    // Обрезаем если превышает лимит Telegram
    if (text.length > TELEGRAM.MAX_MESSAGE_LENGTH) {
      logger.warn(`Message too long: ${text.length}/${TELEGRAM.MAX_MESSAGE_LENGTH} chars. Truncating.`);
      text = text.slice(0, TELEGRAM.MAX_MESSAGE_LENGTH - 120) + '\n\n<i>... (сообщение обрезано)</i>';
    }

    const payload = {
      chat_id:                  chatId,
      text,
      parse_mode:               'HTML',
      disable_web_page_preview: true,
      disable_notification:     false,
      ...extra,
    };

    // Throttle перед отправкой (rate limiting)
    await this.#limiter.throttle();

    const start = Date.now();
    this.#metrics?.increment('telegram.sent');

    try {
      const result = await withRetry(
        () => this.#request('sendMessage', payload),
        {
          retries: 3,
          delay:   2_000,
          label:   'telegram.send',
          shouldRetry: (error) => {
            // Не повторять при клиентских ошибках
            if (TELEGRAM.NO_RETRY_CODES.includes(error.code)) return false;

            // При flood control — ждать retry_after
            if (error.code === TELEGRAM.FLOOD_CONTROL_CODE) {
              const retryAfter = error.parameters?.retry_after ?? 30;
              this.#limiter.onFloodControl(retryAfter);
              return true; // повторять после ожидания
            }

            return true;
          },
        }
      );

      const latencyMs = Date.now() - start;
      this.#metrics?.recordLatency('telegram.latency', latencyMs);

      logger.info('✅ Message sent to Telegram', {
        messageId: result?.message_id,
        chatId,
        latencyMs,
        chars:     text.length,
      });

      return result;
    } catch (error) {
      this.#metrics?.increment('telegram.failed');
      logger.error('Failed to send Telegram message', {
        error:       error.message,
        code:        error.code,
        description: error.description,
        chatId,
      });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public: sendMarketBriefing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Форматирует рыночные данные и отправляет сводку в Telegram.
   * Включает защиту от дублирования (не отправлять одно и то же дважды в день).
   *
   * @param {object}  marketData   - Данные от MarketService
   * @param {object}  [opts]
   * @param {boolean} [opts.force] - Отправить даже если дубликат
   * @returns {Promise<{ sent: boolean, messageId?: number, reason?: string }>}
   */
  async sendMarketBriefing(marketData, opts = {}) {
    const now  = new Date();
    const text = formatMarketMessage(marketData, now);

    // ── Проверка дублирования ────────────────────────────────────────────
    if (!opts.force && this.#state?.isDuplicate(text)) {
      this.#metrics?.increment('dedup.skipped');
      const lastSentAt = this.#state.getLastSentAt();
      logger.warn('📋 Duplicate message detected — skipping send', {
        lastSentAt: lastSentAt?.toISOString(),
        reason:     'Same content already sent today',
      });
      return { sent: false, reason: 'duplicate' };
    }

    // ── Отправка ─────────────────────────────────────────────────────────
    logger.info('Отправка рыночной сводки...', { chars: text.length });

    const result = await this.sendMessage(text);

    // ── Сохранение состояния ─────────────────────────────────────────────
    if (this.#state) {
      this.#state.setLastSentAt(now);
      this.#state.setLastMessageHash(text);
    }

    return { sent: true, messageId: result?.message_id };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public: validateBotToken
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Проверяет валидность токена бота (getMe).
   * @returns {Promise<{ id: number, username: string, firstName: string }>}
   */
  async validateBotToken() {
    try {
      const bot = await withRetry(
        () => this.#request('getMe', {}),
        { retries: 2, delay: 1_000, label: 'getMe' }
      );

      logger.info('✅ Telegram Bot token valid', {
        botId:       bot.id,
        username:    `@${bot.username}`,
        firstName:   bot.first_name,
      });

      return {
        id:        bot.id,
        username:  bot.username,
        firstName: bot.first_name,
      };
    } catch (error) {
      throw new Error(`Неверный TELEGRAM_BOT_TOKEN: ${error.message}`);
    }
  }

  /** Rate limiter stats (для /health) */
  getRateLimiterStats() {
    return this.#limiter.getStats();
  }
}
