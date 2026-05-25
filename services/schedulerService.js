/**
 * services/schedulerService.js
 *
 * Сервис планировщика задач на основе node-cron.
 * Запускает ежедневную рыночную сводку по расписанию.
 *
 * Временная зона: Europe/Amsterdam (CET зимой, CEST летом)
 * По умолчанию: 07:00 каждый день
 *
 * Документация node-cron: https://github.com/node-cron/node-cron
 * Формат cron: секунды(опц.) минуты часы дни_месяца месяцы дни_недели
 *
 * Примеры:
 *   "0 7 * * *"     = 07:00 каждый день
 *   "0 7 * * 1-5"   = 07:00 только будни (Пн-Пт)
 *   "0 7,19 * * *"  = 07:00 и 19:00 каждый день
 */

import cron from 'node-cron';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { fetchMarketData } from './marketService.js';
import { sendMarketBriefing } from './telegramService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Основной обработчик задачи
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Выполняет полный цикл: получение данных → форматирование → отправка.
 * Обрабатывает все ошибки внутри себя (не выбрасывает наружу).
 *
 * @returns {Promise<void>}
 */
export async function runMarketBriefing() {
  const jobStartTime = Date.now();

  logger.separator('ЗАПУСК РЫНОЧНОЙ СВОДКИ');
  logger.info('Начало формирования рыночной сводки...');

  try {
    // Шаг 1: Получить данные от Twelve Data API
    const marketData = await fetchMarketData();

    // Шаг 2: Отправить сформированное сообщение в Telegram
    await sendMarketBriefing(marketData);

    const elapsed = Date.now() - jobStartTime;
    logger.info(`✅ Рыночная сводка отправлена за ${elapsed}ms`);
    logger.separator();
  } catch (error) {
    const elapsed = Date.now() - jobStartTime;
    logger.error(`❌ Ошибка при отправке рыночной сводки (${elapsed}ms)`, {
      error: error.message,
      stack: error.stack,
    });
    logger.separator();
    // Не перебрасываем ошибку — планировщик должен продолжать работу
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Запуск планировщика
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Инициализирует и запускает cron-планировщик.
 *
 * @returns {cron.ScheduledTask} - Экземпляр задачи (можно остановить через .stop())
 */
export function startScheduler() {
  const { cronExpression, timezone, runOnStart } = config.schedule;

  // Валидация cron-выражения перед запуском
  if (!cron.validate(cronExpression)) {
    throw new Error(
      `Неверное cron-выражение: "${cronExpression}"\n` +
      `Пример корректного выражения: "0 7 * * *" (каждый день в 07:00)`
    );
  }

  logger.info('Инициализация планировщика...', {
    cron: cronExpression,
    timezone,
    описание: 'каждый день в 07:00 CET',
  });

  // Создаём cron-задачу
  const task = cron.schedule(
    cronExpression,
    async () => {
      logger.info('⏰ Сработал cron-триггер. Запускаю рыночную сводку...');
      await runMarketBriefing();
    },
    {
      timezone,
      scheduled: true,  // Запустить сразу при создании
    }
  );

  logger.info('✅ Планировщик запущен');

  // Вычисляем следующий запуск для информационного сообщения
  logNextRunTime(cronExpression, timezone);

  // Если RUN_ON_START=true — запустить сразу (полезно для тестирования)
  if (runOnStart) {
    logger.info('🚀 RUN_ON_START=true: запускаю сводку немедленно...');
    // Небольшая задержка для полной инициализации
    setTimeout(() => runMarketBriefing(), 1000);
  }

  return task;
}

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Вычисляет и логирует время следующего запуска задачи.
 * Использует простое вычисление для cron "0 H * * *".
 *
 * @param {string} cronExpr
 * @param {string} timezone
 */
function logNextRunTime(cronExpr, timezone) {
  try {
    // Парсим часы из cron-выражения "0 H * * *"
    const parts = cronExpr.split(' ');
    if (parts.length === 5 && parts[2] === '*') {
      const hour = parseInt(parts[1], 10);
      const minute = parseInt(parts[0], 10);

      if (!isNaN(hour) && !isNaN(minute)) {
        const now = new Date();
        const nextRun = new Date();
        nextRun.setHours(hour, minute, 0, 0);

        // Если время уже прошло сегодня — следующий запуск завтра
        if (nextRun <= now) {
          nextRun.setDate(nextRun.getDate() + 1);
        }

        const timeStr = nextRun.toLocaleString('ru-RU', {
          timeZone: timezone,
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });

        logger.info(`📅 Следующий запуск: ${timeStr} (${timezone})`);
      }
    }
  } catch {
    // Не критично, просто логируем без времени
    logger.info(`📅 Расписание: ${cronExpr} (${timezone})`);
  }
}
