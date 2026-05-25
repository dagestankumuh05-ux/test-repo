/**
 * utils/logger.js
 *
 * Простой логгер с записью в консоль и файл.
 * Не использует внешние зависимости — только стандартный fs модуль.
 * Файлы логов создаются в ./logs/ с именем по дате (YYYY-MM-DD.log).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Создаём директорию для логов, если не существует
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ANSI-цвета для консольного вывода
const COLORS = {
  reset:  '\x1b[0m',
  gray:   '\x1b[90m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  blue:   '\x1b[34m',
  bold:   '\x1b[1m',
};

/**
 * Форматирует текущее время для вывода в консоль (HH:MM:SS).
 * @returns {string}
 */
function getTime() {
  return new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Возвращает ISO-timestamp для логов (UTC).
 * @returns {string}
 */
function getISO() {
  return new Date().toISOString();
}

/**
 * Возвращает дату для имени файла лога (YYYY-MM-DD).
 * @returns {string}
 */
function getLogDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Записывает строку в файл лога.
 * Файл создаётся/дополняется автоматически.
 * @param {string} line - Строка для записи
 */
function writeToFile(line) {
  try {
    const logPath = path.join(LOGS_DIR, `${getLogDate()}.log`);
    fs.appendFileSync(logPath, line + '\n', 'utf8');
  } catch (err) {
    // Не выбрасываем ошибку — логгер не должен ломать приложение
    console.error('[LOGGER] Ошибка записи в файл:', err.message);
  }
}

/**
 * Основная функция логирования.
 * @param {string} level - Уровень: INFO | WARN | ERROR
 * @param {string} color - ANSI-цвет для консоли
 * @param {string} message - Сообщение
 * @param {*} [data] - Дополнительные данные (объект или строка)
 */
function log(level, color, message, data) {
  const iso = getISO();
  const time = getTime();

  // Консольный вывод с цветами
  let consoleMsg = `${COLORS.gray}${time}${COLORS.reset} ${color}${level}${COLORS.reset} ${message}`;
  if (data !== undefined) {
    const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 0) : String(data);
    consoleMsg += ` ${COLORS.gray}${dataStr}${COLORS.reset}`;
  }
  console.log(consoleMsg);

  // Файловый вывод (JSON, без цветов)
  const fileEntry = JSON.stringify({
    timestamp: iso,
    level,
    message,
    ...(data !== undefined && { data }),
  });
  writeToFile(fileEntry);
}

// ─────────────────────────────────────────────────────────────────────────────
// Экспортируемый логгер
// ─────────────────────────────────────────────────────────────────────────────

export const logger = {
  /**
   * Информационное сообщение (стандартные события).
   * @param {string} message
   * @param {*} [data]
   */
  info: (message, data) => log('INFO ', COLORS.green, message, data),

  /**
   * Предупреждение (некритические проблемы, пропущенные данные).
   * @param {string} message
   * @param {*} [data]
   */
  warn: (message, data) => log('WARN ', COLORS.yellow, message, data),

  /**
   * Ошибка (неудачные запросы, критические сбои).
   * @param {string} message
   * @param {*} [data]
   */
  error: (message, data) => log('ERROR', COLORS.red, message, data),

  /**
   * Отладочное сообщение (только при LOG_LEVEL=debug).
   * @param {string} message
   * @param {*} [data]
   */
  debug: (message, data) => {
    if (process.env.LOG_LEVEL === 'debug') {
      log('DEBUG', COLORS.blue, message, data);
    }
  },

  /**
   * Разделитель для визуального разграничения секций в логах.
   * @param {string} [title]
   */
  separator: (title = '') => {
    const line = '─'.repeat(50);
    const msg = title ? `${line} ${title} ${line}` : line.repeat(2);
    console.log(`${COLORS.gray}${msg}${COLORS.reset}`);
    writeToFile(`{"timestamp":"${getISO()}","level":"SEP ","message":"${title || '---'}"}`);
  },
};
