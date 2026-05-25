/**
 * core/container.js
 *
 * Простой DI-контейнер (Dependency Injection) на основе фабричных функций.
 *
 * Принципы:
 * - Каждый сервис регистрируется как фабрика: (container) => instance
 * - Экземпляр создаётся один раз (singleton) при первом запросе
 * - Поддерживает ленивую инициализацию (lazy initialization)
 * - Не требует декораторов или метаданных
 *
 * Совместимость с Redis:
 *   Когда понадобится Redis, достаточно заменить фабрику stateService
 *   на Redis-реализацию — интерфейс остаётся прежним.
 *
 * Использование:
 *   container.register('logger', () => createLogger());
 *   container.register('market', (c) => new MarketService(c.get('logger')));
 *   const market = container.get('market');
 */

export class Container {
  /** @type {Map<string, Function>} */
  #factories = new Map();

  /** @type {Map<string, *>} */
  #singletons = new Map();

  /** @type {Set<string>} Для обнаружения циклических зависимостей */
  #resolving = new Set();

  /**
   * Регистрирует сервис по имени.
   *
   * @param {string}   name     - Уникальное имя сервиса
   * @param {Function} factory  - Фабричная функция: (container) => instance
   * @returns {this}  Для цепочного вызова
   */
  register(name, factory) {
    if (typeof factory !== 'function') {
      throw new TypeError(`Container: фабрика для "${name}" должна быть функцией`);
    }
    if (this.#singletons.has(name)) {
      throw new Error(`Container: сервис "${name}" уже создан (singleton), перерегистрация невозможна`);
    }
    this.#factories.set(name, factory);
    return this;
  }

  /**
   * Регистрирует готовый экземпляр как singleton (минуя фабрику).
   *
   * @param {string} name     - Уникальное имя сервиса
   * @param {*}      instance - Экземпляр для регистрации
   * @returns {this}
   */
  registerInstance(name, instance) {
    this.#singletons.set(name, instance);
    return this;
  }

  /**
   * Возвращает экземпляр сервиса (создаёт при первом обращении).
   *
   * @template T
   * @param {string} name - Имя сервиса
   * @returns {T}
   */
  get(name) {
    // Возвращаем готовый singleton
    if (this.#singletons.has(name)) {
      return this.#singletons.get(name);
    }

    // Проверяем циклические зависимости
    if (this.#resolving.has(name)) {
      throw new Error(
        `Container: циклическая зависимость обнаружена для "${name}"\n` +
        `  Цепочка: ${[...this.#resolving].join(' → ')} → ${name}`
      );
    }

    const factory = this.#factories.get(name);
    if (!factory) {
      throw new Error(
        `Container: сервис "${name}" не зарегистрирован.\n` +
        `  Доступные сервисы: ${[...this.#factories.keys()].join(', ')}`
      );
    }

    // Создаём экземпляр
    this.#resolving.add(name);
    let instance;
    try {
      instance = factory(this);
    } finally {
      this.#resolving.delete(name);
    }

    // Сохраняем как singleton
    this.#singletons.set(name, instance);
    return instance;
  }

  /**
   * Проверяет, зарегистрирован ли сервис.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.#factories.has(name) || this.#singletons.has(name);
  }

  /**
   * Возвращает список всех зарегистрированных сервисов.
   * @returns {string[]}
   */
  list() {
    const names = new Set([...this.#factories.keys(), ...this.#singletons.keys()]);
    return [...names];
  }

  /**
   * Вызывает teardown() на всех созданных сервисах (при shutdown).
   * @returns {Promise<void>}
   */
  async teardown() {
    const tasks = [...this.#singletons.values()]
      .filter((s) => typeof s?.teardown === 'function')
      .map((s) => Promise.resolve(s.teardown()).catch(() => {}));

    await Promise.allSettled(tasks);
  }
}

// Глобальный контейнер приложения
export const container = new Container();
