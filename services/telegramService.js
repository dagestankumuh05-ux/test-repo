/**
 * services/telegramService.js
 * Отправка сообщений в Telegram через Bot API.
 * Использует нативный fetch (Node 18+), без сторонних Telegram-библиотек.
 */

import { config }         from '../config/config.js';
import { logger }         from '../utils/logger.js';
import { fetchWithRetry } from '../utils/retry.js';

const { botToken, chatId, parseMode, apiBase } = config.telegram;

// ─── Базовый запрос к Bot API ─────────────────────────────────────────────────

/**
 * Выполнить метод Telegram Bot API.
 * @param {string} method     — имя метода (sendMessage, getMe, …)
 * @param {Object} params     — параметры метода
 * @returns {Promise<Object>} — поле result из ответа
 */
async function callBotAPI(method, params = {}) {
  const url = `${apiBase}/bot${botToken}/${method}`;

  logger.debug(`[Telegram] Вызов ${method}`, { params });

  const response = await fetchWithRetry(
    url,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
    },
    { context: `Telegram.${method}` }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram API error ${data.error_code}: ${data.description}`
    );
  }

  return data.result;
}

// ─── Публичные функции ────────────────────────────────────────────────────────

/**
 * Отправить HTML-сообщение в настроенный чат.
 * @param {string} text — HTML-текст сообщения
 * @returns {Promise<Object>}  — объект Message от Telegram
 */
export async function sendMessage(text) {
  logger.info('[Telegram] Отправка сообщения', { chatId, length: text.length });

  const result = await callBotAPI('sendMessage', {
    chat_id:                  chatId,
    text,
    parse_mode:               parseMode,
    disable_web_page_preview: true,
    disable_notification:     false,
  });

  logger.info('[Telegram] Сообщение отправлено', {
    messageId: result.message_id,
    chatId:    result.chat.id,
  });

  return result;
}

/**
 * Проверить что бот-токен корректен (вызов getMe).
 * Вызывается при старте приложения.
 * @returns {Promise<Object>} — данные бота { id, username, … }
 */
export async function validateBot() {
  const bot = await callBotAPI('getMe');
  logger.info('[Telegram] Бот подключён', {
    id:       bot.id,
    username: bot.username,
    name:     bot.first_name,
  });
  return bot;
}

/**
 * Отправить уведомление об ошибке администратору.
 * Если ADMIN_CHAT_ID не задан — пишет только в лог.
 * @param {string}  context  — где возникла ошибка
 * @param {Error}   error
 */
export async function notifyError(context, error) {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (!adminChatId) return;

  const text = [
    `⚠️ <b>Ошибка в market bot</b>`,
    ``,
    `<b>Контекст:</b> ${context}`,
    `<b>Ошибка:</b> <code>${escapeHtml(error.message)}</code>`,
    `<b>Время:</b> ${new Date().toISOString()}`,
  ].join('\n');

  try {
    await callBotAPI('sendMessage', {
      chat_id:    adminChatId,
      text,
      parse_mode: 'HTML',
    });
  } catch (e) {
    logger.error('[Telegram] Не удалось отправить уведомление об ошибке', {
      error: e.message,
    });
  }
}

// ─── Вспомогательное ─────────────────────────────────────────────────────────

/**
 * Экранировать HTML-спецсимволы.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
