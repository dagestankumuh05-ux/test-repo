/**
 * index.js
 *
 * Точка входа Telegram Market Bot.
 *
 * Последовательность запуска:
 * 1. Загрузка и валидация конфигурации (.env)
 * 2. Проверка токена Telegram Bot API
 * 3. Запуск cron-планировщика
 * 4. Настройка graceful shutdown
 *
 * Запуск:
 *   node index.js              — обычный запуск
 *   RUN_ON_START=true node index.js — запуск + немедленная отправка (тест)
 */

// Импортируем конфиг первым — он загружает .env и валидирует переменные
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { startScheduler } from './services/schedulerService.js';
import { validateBotToken } from './services/telegramService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Graceful Shutdown
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Настраивает обработчики для корректного завершения работы.
 * PM2 и Docker отправляют SIGTERM при остановке — ловим его.
 *
 * @param {import('node-cron').ScheduledTask} scheduler
 */
function setupGracefulShutdown(scheduler) {
  let isShuttingDown = false;

  const shutdown = (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`\n📴 Получен сигнал ${signal}. Завершаю работу...`);

    // Останавливаем cron-планировщик
    if (scheduler) {
      scheduler.stop();
      logger.info('⏹  Планировщик остановлен');
    }

    logger.info('👋 Бот остановлен');
    process.exit(0);
  };

  // Обычное завершение (Docker stop, pm2 stop, Ctrl+C)
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Необработанные исключения — логируем и завершаем
  process.on('uncaughtException', (error) => {
    logger.error('💥 Необработанное исключение (uncaughtException)', {
      error: error.message,
      stack: error.stack,
    });
    // При uncaughtException состояние процесса неизвестно — лучше перезапустить
    process.exit(1);
  });

  // Необработанные Promise-rejection — логируем, но продолжаем
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('⚠️  Необработанный Promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    // Не завершаем процесс — PM2 это не нужно, это просто предупреждение
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Запуск приложения
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // Шапка при запуске
  logger.separator('TELEGRAM MARKET BOT');
  logger.info('🚀 Запуск бота...');
  logger.info(`Node.js ${process.version} | ENV: ${config.app.nodeEnv} | v${config.app.version}`);
  logger.info(`📋 Расписание: ${config.schedule.cronExpression} (${config.schedule.timezone})`);
  logger.info(`📢 Telegram Chat ID: ${config.telegram.chatId}`);
  logger.separator();

  // Шаг 1: Проверяем токен Telegram
  logger.info('1/2 Проверка Telegram Bot токена...');
  await validateBotToken();

  // Шаг 2: Запускаем планировщик
  logger.info('2/2 Запуск планировщика...');
  const scheduler = startScheduler();

  // Настраиваем корректное завершение
  setupGracefulShutdown(scheduler);

  logger.separator();
  logger.info('✅ Бот запущен и ожидает расписание. Для остановки: Ctrl+C');
  logger.separator();
}

// ─────────────────────────────────────────────────────────────────────────────
// Запуск
// ─────────────────────────────────────────────────────────────────────────────

main().catch((error) => {
  // Фатальная ошибка при старте (неверный .env, нет соединения и т.д.)
  logger.error('💀 Фатальная ошибка при запуске', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
