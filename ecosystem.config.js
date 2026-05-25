/**
 * ecosystem.config.js
 *
 * Конфигурация PM2 для production-деплоя.
 *
 * Установка PM2:  npm install -g pm2
 * Запуск:        pm2 start ecosystem.config.js
 * Статус:        pm2 status
 * Логи:          pm2 logs telegram-market-bot
 * Остановка:     pm2 stop telegram-market-bot
 * Перезапуск:    pm2 restart telegram-market-bot
 * Автозапуск:    pm2 startup && pm2 save
 *
 * Документация PM2: https://pm2.keymetrics.io/docs/usage/application-declaration/
 */

module.exports = {
  apps: [
    {
      // ── Идентификация ──────────────────────────────────────────────────────
      name: 'telegram-market-bot',
      script: 'index.js',

      // ── Режим запуска ──────────────────────────────────────────────────────
      // Один экземпляр (бот не нужно масштабировать)
      instances: 1,
      exec_mode: 'fork',

      // ── Node.js интерпретатор ──────────────────────────────────────────────
      interpreter: 'node',
      // Используем ES Modules
      node_args: '',

      // ── Автоперезапуск ─────────────────────────────────────────────────────
      // Перезапустить при краше
      autorestart: true,
      // Ограничение памяти: перезапуск если > 200 MB
      max_memory_restart: '200M',
      // Минимальное время работы перед тем, как считать запуск успешным (мс)
      min_uptime: '10s',
      // Максимум попыток рестарта подряд (после — "errored")
      max_restarts: 10,
      // Задержка между перезапусками (мс)
      restart_delay: 5000,

      // ── Слежение за файлами ────────────────────────────────────────────────
      // false = не перезапускать при изменении файлов (production-режим)
      watch: false,

      // ── Переменные окружения ───────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
        // Остальные переменные берём из .env файла
      },
      // Для разработки: pm2 start ecosystem.config.js --env development
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
        RUN_ON_START: 'true',
      },

      // ── Логирование ────────────────────────────────────────────────────────
      // Формат даты в логах PM2
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Файлы для stdout и stderr
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      // Объединить stdout и stderr в один файл
      combine_logs: false,
      // Не логировать pid в файл
      pid_file: './logs/pm2.pid',

      // ── Kill timeout ───────────────────────────────────────────────────────
      // Время ожидания graceful shutdown (мс) перед принудительным SIGKILL
      kill_timeout: 5000,

      // ── Прочее ─────────────────────────────────────────────────────────────
      // Не открывать браузер после запуска
      treekill: true,
    },
  ],
};
