/**
 * index.js
 * Точка входа приложения — Telegram Market Bot.
 *
 * Жизненный цикл:
 *  1. Загрузить конфигурацию и валидировать .env
 *  2. Проверить Telegram Bot-токен (getMe)
 *  3. Запустить cron-планировщик
 *  4. Если передан флаг --send-now | --dry-run — выполнить немедленно
 *  5. Graceful shutdown при SIGTERM / SIGINT
 */

// dotenv загружается внутри config/config.js
import { config }               from './config/config.js';
import { logger }               from './utils/logger.js';
import { validateBot }          from './services/telegramService.js';
import { startScheduler, runMarketBriefing, stopScheduler } from './services/schedulerService.js';

// ─── Флаги командной строки ───────────────────────────────────────────────────
const args      = process.argv.slice(2);
const SEND_NOW  = args.includes('--send-now');   // немедленно отправить и продолжать работу
const DRY_RUN   = args.includes('--dry-run');    // только проверить соединение, не отправлять

// ─── Graceful shutdown ────────────────────────────────────────────────────────
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`[App] Получен сигнал ${signal}, завершение...`);
  stopScheduler();

  // Дать время на завершение текущих задач
  await new Promise(resolve => setTimeout(resolve, 500));

  logger.info('[App] Приложение остановлено');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error('[App] Необработанное исключение', {
    error: error.message,
    stack: error.stack,
  });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('[App] Необработанный rejection', {
    reason: String(reason),
  });
});

// ─── Запуск ───────────────────────────────────────────────────────────────────
async function main() {
  logger.info('═══════════════════════════════════════════');
  logger.info('  Telegram Market Bot — запуск');
  logger.info(`  Node.js ${process.version}`);
  logger.info(`  Cron: ${config.scheduler.cronTime} (${config.scheduler.timezone})`);
  logger.info('═══════════════════════════════════════════');

  // 1. Проверить Telegram-токен
  try {
    await validateBot();
  } catch (error) {
    logger.error('[App] Ошибка подключения к Telegram', { error: error.message });
    logger.error('[App] Проверьте TELEGRAM_BOT_TOKEN в файле .env');
    process.exit(1);
  }

  // 2. DRY RUN — только проверить конфигурацию
  if (DRY_RUN) {
    logger.info('[App] --dry-run: конфигурация корректна, выход');
    process.exit(0);
  }

  // 3. --send-now: немедленно выполнить первую публикацию
  if (SEND_NOW) {
    logger.info('[App] --send-now: немедленная публикация');
    await runMarketBriefing();
  }

  // 4. Запустить планировщик
  startScheduler();

  logger.info('[App] Бот запущен и ожидает расписания. Для выхода: Ctrl+C');
}

// ─── Запуск ───────────────────────────────────────────────────────────────────
main().catch((error) => {
  logger.error('[App] Критическая ошибка при запуске', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
