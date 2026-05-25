/**
 * index.js — Точка входа Telegram Market Bot v2.0
 *
 * Последовательность запуска:
 * 1. Загрузка и Zod-валидация конфигурации (.env)
 * 2. Инициализация DI-контейнера (сборка зависимостей)
 * 3. Регистрация обработчиков сигналов (graceful shutdown)
 * 4. Проверка токена Telegram Bot API
 * 5. Запуск health HTTP-сервера (:3000)
 * 6. Запуск cron-планировщика (07:00 CET)
 * 7. Ожидание событий
 *
 * Переменные окружения:
 *   TELEGRAM_BOT_TOKEN  — обязательно
 *   TELEGRAM_CHAT_ID    — обязательно
 *   TWELVE_DATA_API_KEY — обязательно
 *   (остальные — см. .env.example)
 */

// ── Конфиг должен быть первым (загружает .env и валидирует через Zod) ────────
import { config } from './config/index.js';

import { logger }          from './utils/logger.js';
import { container }       from './core/container.js';
import { ProcessManager }  from './core/processManager.js';
import { HealthServer }    from './core/healthServer.js';
import { MetricsService }  from './services/metricsService.js';
import { StateService }    from './services/stateService.js';
import { MarketService }   from './services/marketService.js';
import { TelegramService } from './services/telegramService.js';
import { SchedulerService }from './services/schedulerService.js';

// ─────────────────────────────────────────────────────────────────────────────
// DI: Регистрация сервисов
// ─────────────────────────────────────────────────────────────────────────────

function wireContainer() {
  // Базовые сервисы (нет зависимостей на другие сервисы)
  container.register('metrics', () => new MetricsService());
  container.register('state',   () => new StateService());

  // Сервис рыночных данных (зависит от metrics, state)
  container.register('market', (c) => new MarketService({
    metrics: c.get('metrics'),
    state:   c.get('state'),
  }));

  // Сервис Telegram (зависит от metrics, state)
  container.register('telegram', (c) => new TelegramService({
    metrics: c.get('metrics'),
    state:   c.get('state'),
  }));

  // Планировщик (зависит от всего)
  container.register('scheduler', (c) => new SchedulerService({
    market:   c.get('market'),
    telegram: c.get('telegram'),
    metrics:  c.get('metrics'),
    state:    c.get('state'),
  }));

  // Health-сервер (зависит от metrics, state, config)
  container.register('health', (c) => new HealthServer({
    metrics: c.get('metrics'),
    state:   c.get('state'),
    config,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Запуск
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // Шапка
  logger.separator('TELEGRAM MARKET BOT v2.0');
  logger.info('🚀 Запуск...', {
    node:    process.version,
    env:     config.app.nodeEnv,
    version: config.app.version,
    pid:     process.pid,
  });
  logger.info('📋 Конфигурация:', {
    cron:      config.schedule.cronExpression,
    timezone:  config.schedule.timezone,
    chatId:    config.telegram.chatId,
    quota:     `${config.twelveData.dailyQuota} credits/day`,
    health:    config.health.enabled ? `порт ${config.health.port}` : 'disabled',
  });
  logger.separator();

  // ── Инициализация DI ──────────────────────────────────────────────────────
  logger.info('1/5 Инициализация сервисов...');
  wireContainer();

  const metrics  = container.get('metrics');
  const state    = container.get('state');
  const telegram = container.get('telegram');
  const health   = container.get('health');
  const scheduler = container.get('scheduler');

  // ── ProcessManager: graceful shutdown ─────────────────────────────────────
  logger.info('2/5 Настройка graceful shutdown...');
  const pm = new ProcessManager();
  pm
    .install()
    .onShutdown('scheduler', () => scheduler.teardown())
    .onShutdown('health',    () => health.teardown())
    .onShutdown('state',     () => state.flush())
    .registerContainer(container);

  // ── Валидация Telegram токена ─────────────────────────────────────────────
  logger.info('3/5 Проверка Telegram Bot токена...');
  const botInfo = await telegram.validateBotToken();
  metrics.setGauge('bot.id',       botInfo.id);
  metrics.setGauge('bot.username', botInfo.username);

  // ── Health server ─────────────────────────────────────────────────────────
  if (config.health.enabled) {
    logger.info('4/5 Запуск health-сервера...');
    await health.start();
  } else {
    logger.info('4/5 Health-сервер отключён (HEALTH_ENABLED=false)');
  }

  // ── Планировщик ───────────────────────────────────────────────────────────
  logger.info('5/5 Запуск планировщика...');
  scheduler.start();

  // Сообщаем health-серверу что готовы
  health.markReady();

  // Запускаем периодическое логирование памяти (каждые 5 минут)
  const memInterval = setInterval(() => metrics.logMemoryUsage(), 5 * 60 * 1_000);
  memInterval.unref();

  logger.separator();
  logger.info('✅ Бот запущен и ожидает расписание');
  logger.info('   Для остановки: Ctrl+C');
  logger.separator();
}

// ─────────────────────────────────────────────────────────────────────────────
// Запуск с обработкой фатальных ошибок
// ─────────────────────────────────────────────────────────────────────────────

main().catch((error) => {
  // Фатальная ошибка при старте (невалидный .env, нет сети и т.д.)
  logger.error('💀 Фатальная ошибка при запуске', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(2); // EXIT_CODES.CONFIG_ERROR
});
