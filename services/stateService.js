/**
 * services/stateService.js
 *
 * Персистентное хранилище состояния приложения в JSON-файле.
 *
 * Хранит:
 * - lastSentAt        — время последней успешной отправки
 * - lastMessageHash   — хэш последнего сообщения (для дедупликации)
 * - schedulerLock     — блокировка cron (singleton protection)
 * - apiQuota          — использование квоты Twelve Data API
 *
 * Совместимость с Redis:
 *   Интерфейс идентичен Redis-реализации.
 *   Для миграции на Redis — заменить только этот файл,
 *   вызывающий код не изменяется.
 *
 * Важно: в Docker-деплое директорию ./state нужно монтировать как volume,
 * чтобы состояние сохранялось между перезапусками контейнера.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { STATE, SCHEDULER } from '../config/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Начальное состояние
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  lastSentAt:       null,       // ISO string или null
  lastMessageHash:  null,       // sha256 хэш или null
  schedulerLock:    null,       // { pid, startedAt, correlationId } или null
  apiQuota: {
    used:       0,              // Использовано кредитов за сегодня
    resetAt:    null,           // ISO string — когда сбросится квота
    dailyLimit: 800,            // Дневной лимит (Free план)
  },
};

export class StateService {
  #statePath;
  #state = { ...DEFAULT_STATE, apiQuota: { ...DEFAULT_STATE.apiQuota } };
  #dirty = false;
  #saveTimer = null;

  constructor(statePath = STATE.FILE) {
    this.#statePath = path.resolve(statePath);
    this.#ensureDir();
    this.#load();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Инициализация
  // ─────────────────────────────────────────────────────────────────────────

  #ensureDir() {
    const dir = path.dirname(this.#statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  #load() {
    try {
      if (fs.existsSync(this.#statePath)) {
        const raw  = fs.readFileSync(this.#statePath, 'utf8');
        const data = JSON.parse(raw);
        // Мержим с DEFAULT_STATE чтобы новые поля появлялись автоматически
        this.#state = {
          ...DEFAULT_STATE,
          ...data,
          apiQuota: { ...DEFAULT_STATE.apiQuota, ...data.apiQuota },
        };
        logger.debug('State loaded', { path: this.#statePath });
      } else {
        logger.debug('State file not found, starting fresh', { path: this.#statePath });
      }
    } catch (error) {
      logger.warn('Failed to load state file, starting fresh', {
        path:  this.#statePath,
        error: error.message,
      });
      this.#state = { ...DEFAULT_STATE, apiQuota: { ...DEFAULT_STATE.apiQuota } };
    }
  }

  #save() {
    try {
      const json = JSON.stringify(this.#state, null, 2);
      fs.writeFileSync(this.#statePath, json, 'utf8');
      this.#dirty = false;
    } catch (error) {
      logger.error('Failed to save state file', { path: this.#statePath, error: error.message });
    }
  }

  /** Откладывает запись на STATE.WRITE_DEBOUNCE_MS (избегаем лишних disk I/O) */
  #scheduleSave() {
    this.#dirty = true;
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#save(), 500);
  }

  /** Сохраняет немедленно (при shutdown) */
  flush() {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    if (this.#dirty) this.#save();
  }

  teardown() {
    this.flush();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Last Send State
  // ─────────────────────────────────────────────────────────────────────────

  /** Возвращает время последней успешной отправки (Date или null) */
  getLastSentAt() {
    return this.#state.lastSentAt ? new Date(this.#state.lastSentAt) : null;
  }

  /** Обновляет время последней отправки */
  setLastSentAt(date = new Date()) {
    this.#state.lastSentAt = date instanceof Date ? date.toISOString() : date;
    this.#scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Message Deduplication
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Вычисляет SHA-256 хэш сообщения.
   * @param {string} message
   * @returns {string}
   */
  static hashMessage(message) {
    return createHash('sha256').update(message, 'utf8').digest('hex').slice(0, 16);
  }

  /** Возвращает хэш последнего отправленного сообщения */
  getLastMessageHash() {
    return this.#state.lastMessageHash;
  }

  /**
   * Проверяет, является ли сообщение дубликатом (уже отправлялось сегодня).
   *
   * @param {string} message - Текст сообщения для проверки
   * @returns {boolean}
   */
  isDuplicate(message) {
    const hash    = StateService.hashMessage(message);
    const lastAt  = this.getLastSentAt();

    if (!lastAt || !this.#state.lastMessageHash) return false;

    // Считаем дубликатом только если отправлено СЕГОДНЯ с тем же содержимым
    const today = new Date().toDateString();
    const sentDay = lastAt.toDateString();
    const sameDay = today === sentDay;

    return sameDay && hash === this.#state.lastMessageHash;
  }

  /** Сохраняет хэш последнего сообщения */
  setLastMessageHash(message) {
    this.#state.lastMessageHash = StateService.hashMessage(message);
    this.#scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scheduler Lock (singleton protection)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Пытается захватить блокировку планировщика.
   * Возвращает false если блокировка уже захвачена другим процессом.
   *
   * @param {string} correlationId - ID текущего запуска
   * @returns {boolean} true если блокировка захвачена успешно
   */
  acquireLock(correlationId) {
    const existing = this.#state.schedulerLock;

    if (existing) {
      const age = Date.now() - new Date(existing.startedAt).getTime();

      // Если блокировка устарела — считаем её невалидной
      if (age < SCHEDULER.LOCK_TTL_MS) {
        logger.warn('Scheduler lock already held, skipping execution', {
          lockPid:       existing.pid,
          lockStartedAt: existing.startedAt,
          lockAge:       `${Math.round(age / 1000)}s`,
          lockCid:       existing.correlationId,
        });
        return false;
      }

      logger.warn('Stale scheduler lock detected, overriding', {
        lockAge: `${Math.round(age / 1000)}s`,
        ttl:     `${SCHEDULER.LOCK_TTL_MS / 1000}s`,
      });
    }

    this.#state.schedulerLock = {
      pid:           process.pid,
      startedAt:     new Date().toISOString(),
      correlationId,
    };
    this.#save(); // Немедленное сохранение блокировки
    return true;
  }

  /** Освобождает блокировку планировщика */
  releaseLock() {
    this.#state.schedulerLock = null;
    this.#save();
  }

  /** Проверяет, захвачена ли блокировка */
  isLocked() {
    const lock = this.#state.schedulerLock;
    if (!lock) return false;
    const age = Date.now() - new Date(lock.startedAt).getTime();
    return age < SCHEDULER.LOCK_TTL_MS;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API Quota Tracking
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Инициализирует или сбрасывает квоту (если наступил новый день).
   * @param {number} dailyLimit
   */
  initQuota(dailyLimit) {
    const now = new Date();
    const resetAt = this.#state.apiQuota.resetAt
      ? new Date(this.#state.apiQuota.resetAt)
      : null;

    // Сброс квоты если наступил новый день
    if (!resetAt || now >= resetAt) {
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(0, 0, 0, 0);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

      this.#state.apiQuota = {
        used:       0,
        resetAt:    tomorrow.toISOString(),
        dailyLimit: dailyLimit,
      };
      this.#scheduleSave();
      logger.debug('API quota reset for new day', { resetAt: tomorrow.toISOString() });
    } else {
      // Обновляем лимит если изменился
      this.#state.apiQuota.dailyLimit = dailyLimit;
    }
  }

  /**
   * Увеличивает счётчик использованных кредитов.
   * @param {number} [credits=1]
   */
  incrementQuota(credits = 1) {
    this.#state.apiQuota.used += credits;
    this.#scheduleSave();

    const { used, dailyLimit } = this.#state.apiQuota;
    const ratio = used / dailyLimit;

    if (ratio >= 0.9) {
      logger.warn('⚠️ API quota at 90%!', { used, dailyLimit, remaining: dailyLimit - used });
    } else if (ratio >= 0.8) {
      logger.warn('API quota at 80%', { used, dailyLimit, remaining: dailyLimit - used });
    }
  }

  /** Возвращает текущее состояние квоты */
  getQuota() {
    return { ...this.#state.apiQuota };
  }

  /** Проверяет достаточно ли квоты для запроса */
  hasQuota(requiredCredits = 1) {
    const { used, dailyLimit } = this.#state.apiQuota;
    return (used + requiredCredits) <= dailyLimit;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Полный снимок состояния
  // ─────────────────────────────────────────────────────────────────────────

  getSnapshot() {
    return {
      lastSentAt:      this.#state.lastSentAt,
      hasMessageHash:  !!this.#state.lastMessageHash,
      schedulerLocked: this.isLocked(),
      apiQuota:        this.getQuota(),
    };
  }
}
