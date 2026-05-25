/**
 * services/telegramService.js
 *
 * Сервис отправки сообщений через Telegram Bot API.
 *
 * Документация Telegram Bot API: https://core.telegram.org/bots/api#sendmessage
 * Используется parse_mode: HTML для форматирования.
 *
 * Лимиты Telegram Bot API:
 *   - Не более 30 сообщений/сек для одного бота
 *   - Не более 20 сообщений/мин в одну группу
 *   - Максимальная длина сообщения: 4096 символов
 */

import { config } from '../config/index.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { formatMarketMessage } from '../utils/formatter.js';

// Базовый URL Telegram Bot API
const TG_API_BASE = `https://api.telegram.org/bot${config.telegram.botToken}`;

// Максимальная длина одного сообщения Telegram
const MAX_MESSAGE_LENGTH = 4096;

// Таймаут для Telegram API запросов (10 секунд)
const TELEGRAM_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Выполняет fetch-запрос к Telegram API с таймаутом.
 *
 * @param {string} endpoint - Эндпоинт без базового URL (например: '/sendMessage')
 * @param {object} body     - Тело запроса
 * @returns {Promise<object>} - Ответ Telegram API
 */
async function telegramRequest(endpoint, body) {
  const url = `${TG_API_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error(`Telegram API таймаут: ${TELEGRAM_TIMEOUT_MS}ms`)),
    TELEGRAM_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramMarketBot/1.0',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!data.ok) {
      // Формируем понятное сообщение об ошибке
      const errMsg = `Telegram API вернул ошибку: [${data.error_code}] ${data.description}`;
      const error = new Error(errMsg);
      error.code = data.error_code;
      error.description = data.description;
      throw error;
    }

    return data.result;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Публичные функции
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Отправляет HTML-сообщение в указанный чат.
 *
 * @param {string} text              - HTML-текст сообщения
 * @param {string} [chatId]          - ID чата (по умолчанию из config)
 * @param {object} [extraOptions={}] - Дополнительные опции Telegram API
 * @returns {Promise<object>} - Объект отправленного сообщения
 */
export async function sendMessage(text, chatId = config.telegram.chatId, extraOptions = {}) {
  // Проверяем длину сообщения
  if (text.length > MAX_MESSAGE_LENGTH) {
    logger.warn(`Сообщение превышает лимит (${text.length}/${MAX_MESSAGE_LENGTH} символов). Обрезаем.`);
    text = text.slice(0, MAX_MESSAGE_LENGTH - 100) + '\n\n<i>... (сообщение обрезано)</i>';
  }

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    disable_notification: false,  // true = без звука
    ...extraOptions,
  };

  return withRetry(
    () => telegramRequest('/sendMessage', payload),
    {
      retries: 3,
      delay: 2000,
      backoff: 2,
      label: 'telegram-send',
      // Не повторяем при ошибках авторизации (неверный токен, бот заблокирован)
      shouldRetry: (error) => {
        const noRetry = [400, 401, 403];
        return !noRetry.includes(error.code);
      },
    }
  );
}

/**
 * Отправляет рыночную сводку в Telegram.
 * Форматирует данные и отправляет готовое сообщение.
 *
 * @param {object} marketData - Данные котировок из marketService
 * @returns {Promise<void>}
 */
export async function sendMarketBriefing(marketData) {
  logger.info('Форматирование и отправка рыночной сводки...');

  const now = new Date();
  const text = formatMarketMessage(marketData, now);

  logger.debug('Сформированное сообщение:', { length: text.length, preview: text.slice(0, 100) });

  try {
    const result = await sendMessage(text);
    logger.info('Рыночная сводка успешно отправлена в Telegram', {
      messageId: result?.message_id,
      chatId: config.telegram.chatId,
    });
  } catch (error) {
    logger.error('Не удалось отправить сообщение в Telegram', {
      error: error.message,
      code: error.code,
    });
    throw error;
  }
}

/**
 * Проверяет соединение с Telegram API (метод getMe).
 * Используется при старте для валидации токена.
 *
 * @returns {Promise<object>} - Информация о боте
 */
export async function validateBotToken() {
  try {
    const botInfo = await withRetry(
      () => telegramRequest('/getMe', {}),
      { retries: 2, delay: 1000, label: 'telegram-getMe' }
    );
    logger.info('Telegram Bot токен валиден', {
      botName: botInfo.username,
      botId: botInfo.id,
    });
    return botInfo;
  } catch (error) {
    logger.error('Telegram Bot токен невалиден!', { error: error.message });
    throw new Error(`Неверный TELEGRAM_BOT_TOKEN: ${error.message}`);
  }
}
