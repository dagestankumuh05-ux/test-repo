# 📊 Telegram Market Bot

Production-ready Telegram-бот на Node.js, который каждое утро в **07:00 CET** публикует рыночную сводку в ваш канал или чат.

## Пример сообщения

```
📊 Утренний рынок
24 мая 2026 г.

— Крипто —
₿ BTC/USD — $108,240 ▲ +2.40%
Ξ ETH/USD — $5,120 ▲ +1.80%

— Валюты —
💵 USD/RUB — 79.34 ▼ -0.20%
💶 EUR/USD — 1.0842 ▲ +0.10%

— Сырьё —
🥇 Gold — $3,420.0 ▼ -0.80%
🛢 Brent — $81.20 ▼ -1.10%

— Индексы —
🇷🇺 IMOEX — 3,482 ▲ +0.50%
🇺🇸 S&P 500 — 6,102 ▲ +0.30%

⏰ 07:00 CET
```

---

## Структура проекта

```
telegram-market-bot/
├── index.js                   # Точка входа
├── config/
│   └── config.js              # Конфигурация из .env
├── services/
│   ├── marketDataService.js   # Получение котировок (Twelve Data + Binance)
│   ├── telegramService.js     # Отправка сообщений в Telegram
│   └── schedulerService.js    # Cron-планировщик
├── utils/
│   ├── formatter.js           # Форматирование сообщения
│   ├── logger.js              # Winston-логгер
│   └── retry.js               # Retry + fetchWithTimeout
├── logs/                      # Автоматически создаётся
├── .env.example               # Шаблон переменных окружения
├── ecosystem.config.cjs       # Конфигурация PM2
├── Dockerfile
└── docker-compose.yml
```

---

## Быстрый старт

### 1. Клонировать репозиторий

```bash
git clone <your-repo-url>
cd telegram-market-bot
```

### 2. Установить зависимости

```bash
npm install
```

### 3. Создать файл `.env`

```bash
cp .env.example .env
nano .env   # или любой редактор
```

### 4. Заполнить `.env` (см. инструкции ниже)

```env
TELEGRAM_BOT_TOKEN=7123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=-1001234567890
TWELVE_DATA_API_KEY=abc123def456...
```

### 5. Запустить

```bash
# Разработка (с автоперезагрузкой)
npm run dev

# Production (напрямую)
npm start

# Немедленно отправить сообщение + запустить расписание
node index.js --send-now

# Только проверить конфигурацию (не отправляет)
node index.js --dry-run
```

---

## 🔑 Получение ключей

### Telegram Bot Token

1. Откройте Telegram, найдите **@BotFather**
2. Отправьте команду `/newbot`
3. Придумайте имя бота (например: `Morning Market Bot`)
4. Придумайте username (например: `morning_market_bot`) — должен заканчиваться на `bot`
5. BotFather выдаст токен вида: `7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
6. Скопируйте в `TELEGRAM_BOT_TOKEN`

### Telegram Chat ID

**Вариант A — личный чат с ботом:**
1. Перейдите в чат с вашим ботом, нажмите `/start`
2. Откройте в браузере: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Найдите `"chat":{"id": XXXXXXX}` — это ваш Chat ID
4. Вставьте в `TELEGRAM_CHAT_ID=XXXXXXX`

**Вариант B — Telegram-канал:**
1. Создайте канал (или используйте существующий)
2. Добавьте бота в канал как **администратора** с правом публиковать сообщения
3. Перешлите любое сообщение из канала боту **@userinfobot**
4. Он покажет `Id: -100XXXXXXXXXX` — это ID канала
5. Вставьте в `TELEGRAM_CHAT_ID=-100XXXXXXXXXX` (с минусом!)

**Вариант C — группа:**
1. Добавьте бота в группу
2. Добавьте **@userinfobot** в группу, он напишет ID группы
3. Удалите @userinfobot из группы после получения ID

### Twelve Data API Key

1. Зарегистрируйтесь на [twelvedata.com](https://twelvedata.com)
2. Перейдите в **My Account → API Keys**
3. Скопируйте API Key
4. Вставьте в `TWELVE_DATA_API_KEY`

**Бесплатный план:** 800 запросов/день — достаточно (бот делает **1 batch-запрос** в день).

---

## 🚀 Production: запуск через PM2

PM2 — менеджер процессов Node.js с автоперезапуском при краше и при перезагрузке сервера.

### Установка PM2

```bash
npm install -g pm2
```

### Запуск бота

```bash
# Запустить
pm2 start ecosystem.config.cjs

# Проверить статус
pm2 status

# Просмотр логов в реальном времени
pm2 logs market-bot

# Просмотр логов (последние 100 строк)
pm2 logs market-bot --lines 100
```

### Автозапуск при перезагрузке сервера

```bash
# Сохранить список процессов
pm2 save

# Добавить PM2 в автозагрузку (покажет команду для вашей ОС)
pm2 startup

# Выполните команду, которую напечатает pm2 startup (она начинается с sudo)
```

### Управление процессом

```bash
pm2 restart market-bot   # Перезапустить
pm2 stop market-bot      # Остановить
pm2 delete market-bot    # Удалить из PM2
pm2 reload market-bot    # Zero-downtime reload
```

---

## 🐳 Production: запуск через Docker

### Предварительно создайте `.env` файл!

```bash
cp .env.example .env
# Заполните .env своими ключами
```

### Запуск

```bash
# Собрать образ и запустить
docker compose up -d

# Просмотр логов
docker compose logs -f market-bot

# Остановить
docker compose down

# Обновить (пересобрать)
docker compose up -d --build
```

### Без Docker Compose

```bash
# Собрать образ
docker build -t telegram-market-bot .

# Запустить
docker run -d \
  --name market-bot \
  --restart unless-stopped \
  --env-file .env \
  -v $(pwd)/logs:/app/logs \
  telegram-market-bot
```

---

## ⚙️ Конфигурация `.env`

| Переменная | Обязательная | Описание | Пример |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Токен бота от @BotFather | `7123456789:AAH...` |
| `TELEGRAM_CHAT_ID` | ✅ | ID чата/канала | `-1001234567890` |
| `TWELVE_DATA_API_KEY` | ✅ | Ключ Twelve Data API | `abc123def...` |
| `CRON_TIME` | — | Расписание cron | `0 7 * * *` (07:00) |
| `TIMEZONE` | — | Часовой пояс | `Europe/Amsterdam` |
| `LOG_LEVEL` | — | Уровень логов | `info` |
| `REQUEST_TIMEOUT_MS` | — | Таймаут HTTP-запросов | `10000` |
| `RETRY_ATTEMPTS` | — | Попыток при ошибке | `3` |
| `ADMIN_CHAT_ID` | — | Ваш личный Chat ID для уведомлений об ошибках | `123456789` |

### Примеры `CRON_TIME`

```
0 7 * * *      — каждый день в 07:00
0 8 * * 1-5    — будни в 08:00
0 7,19 * * *   — в 07:00 и 19:00
*/30 * * * *   — каждые 30 минут (для тестирования)
```

---

## 📡 API-источники данных

| Инструмент | Источник | Примечание |
|---|---|---|
| BTC/USD | Binance (primary) | Без ключа, fallback → Twelve Data |
| ETH/USD | Binance (primary) | Без ключа, fallback → Twelve Data |
| USD/RUB | Twelve Data | Требует API ключ |
| EUR/USD | Twelve Data | Требует API ключ |
| XAU/USD (Gold) | Twelve Data | Требует API ключ |
| Brent Oil | Twelve Data | Символ `BZ=F` (NYMEX фьючерс) |
| IMOEX | Twelve Data | Символ `IMOEX:MOEX` |
| S&P 500 | Twelve Data | Символ `SPX` |

**Оптимизация:** все Twelve Data запросы объединены в **1 batch-запрос** (`/quote?symbol=...,...,...`).

> **Примечание по IMOEX и Brent:** Доступность этих инструментов зависит от вашего плана Twelve Data. На бесплатном плане могут быть ограничения. Если данные недоступны — бот покажет `данные недоступны` для этой строки и продолжит работу.

---

## 🪵 Логи

```
logs/
├── combined.log   # Все события (JSON, ротация по 10 МБ)
├── error.log      # Только ошибки (JSON, ротация по 5 МБ)
├── pm2-out.log    # stdout от PM2
└── pm2-error.log  # stderr от PM2
```

Просмотр в реальном времени:

```bash
tail -f logs/combined.log | python3 -m json.tool   # красивый JSON
# или
pm2 logs market-bot                                 # через PM2
```

---

## 🔧 Отладка и тестирование

```bash
# Отправить сообщение немедленно (без ожидания расписания)
node index.js --send-now

# Только проверить что .env заполнен и токен работает
node index.js --dry-run

# Запустить с debug-логами
LOG_LEVEL=debug node index.js --send-now
```

---

## 🛡 Надёжность

- **Retry с exponential backoff** — 3 попытки, задержки 1с → 2с → 4с
- **Таймаут** — каждый HTTP-запрос прерывается через 10 секунд
- **Parallel fetching** — Binance и Twelve Data запрашиваются одновременно
- **Fallback** — если Binance недоступен, крипта запрашивается через Twelve Data
- **Partial failure** — если один источник упал, остальные данные всё равно публикуются
- **Graceful shutdown** — SIGTERM/SIGINT корректно завершает работу
- **PM2 autorestart** — бот перезапускается при краше
- **uncaughtException handler** — ловит непредвиденные ошибки

---

## 📦 Зависимости

| Пакет | Версия | Назначение |
|---|---|---|
| `dotenv` | ^16.4 | Загрузка `.env` |
| `node-cron` | ^3.0 | Cron-планировщик |
| `winston` | ^3.14 | Логирование |

Node.js встроенный `fetch` используется для всех HTTP-запросов (Node 18+).

---

## 🔄 Расширение бота

Добавить новый инструмент:

1. **`config/config.js`** — добавить символ в `twelveData.symbols` или `binance.symbols`
2. **`services/marketDataService.js`** — получить данные (уже в batch-запросе)
3. **`utils/formatter.js`** — добавить строку в `formatMarketMessage()`

---

## Лицензия

MIT
