/**
 * services/schedulerService.js
 * Планировщик на node-cron для ежедневной публикации market-сводки.
 */

import cron                        from 'node-cron';
import { config }                  from '../config/config.js';
import { logger }                  from '../utils/logger.js';
import { fetchAllMarketData }      from './marketDataService.js';
import { sendMessage, notifyError } from './telegramService.js';
import { formatMarketMessage, formatMarketPreview } from '../utils/formatter.js';

let scheduledTask = null;

// ─── Основное действие: сбор данных и публикация ─────────────────────────────

/**
 * Выполнить market-сводку: получить данные, сформировать сообщение, отправить.
 */
export async function runMarketBriefing() {
  logger.info('[Scheduler] Запуск market briefing');

  try {
    // 1. Получить данные
    const marketData = await fetchAllMarketData();

    // 2. Сформировать сообщение
    const message = formatMarketMessage(marketData);
    const preview = formatMarketPreview(marketData);

    logger.info(`[Scheduler] Данные готовы: ${preview}`);

    // 3. Отправить в Telegram
    await sendMessage(message);

    logger.info('[Scheduler] Market briefing успешно опубликован');
  } catch (error) {
    logger.error('[Scheduler] Ошибка при выполнении briefing', {
      error: error.message,
      stack: error.stack,
    });

    // Уведомить администратора если настроен ADMIN_CHAT_ID
    await notifyError('runMarketBriefing', error);
  }
}

// ─── Запуск планировщика ──────────────────────────────────────────────────────

/**
 * Инициализировать и запустить cron-задачу.
 * @returns {{ task: ScheduledTask, stop: Function }}
 */
export function startScheduler() {
  const { cronTime, timezone } = config.scheduler;

  // Валидация cron-выражения
  if (!cron.validate(cronTime)) {
    throw new Error(`Некорректное cron-выражение: "${cronTime}"`);
  }

  logger.info('[Scheduler] Регистрация cron-задачи', { cronTime, timezone });

  scheduledTask = cron.schedule(cronTime, runMarketBriefing, {
    timezone,
    scheduled: true,  // запустить сразу
  });

  // Вычислить следующий запуск для информационного вывода
  const nextRun = getNextRunDescription(cronTime, timezone);
  logger.info(`[Scheduler] Следующая публикация: ${nextRun}`);

  return {
    task: scheduledTask,
    stop: stopScheduler,
  };
}

/**
 * Остановить планировщик (graceful shutdown).
 */
export function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('[Scheduler] Планировщик остановлен');
  }
}

// ─── Вспомогательное ─────────────────────────────────────────────────────────

/**
 * Описание следующего запуска в читаемом виде.
 * @param {string} cronExpr
 * @param {string} timezone
 * @returns {string}
 */
function getNextRunDescription(cronExpr, timezone) {
  try {
    // Простое описание по cron-выражению
    const parts = cronExpr.split(' ');
    if (parts.length === 5) {
      const [minute, hour] = parts;
      if (!/[*,/-]/.test(hour) && !/[*,/-]/.test(minute)) {
        return `ежедневно в ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} ${timezone}`;
      }
    }
    return `по расписанию "${cronExpr}" (${timezone})`;
  } catch {
    return cronExpr;
  }
}
