# 📊 Telegram Market Bot

Telegram-бот для ежедневной публикации утренней рыночной сводки.
Публикует в **07:00 CET** актуальные котировки: BTC, ETH, USD/RUB, EUR/USD, Gold, Brent Oil, IMOEX и S&P 500.

**Источник данных:** [Twelve Data API](https://twelvedata.com)

---

## 📱 Пример сообщения

```
📊 Утренний рынок
Понедельник, 25 мая 2026

🔐 Крипто
₿ BTC — $108,240 🟢 +2.40%
Ξ ETH — $5,120 🟢 +1.80%

💱 Валюты
💵 USD/RUB — 79.34 🔴 -0.20%
💶 EUR/USD — 1.0842 🟢 +0.10%

🏦 Сырьё
🥇 Gold — $3,420 🔴 -0.80%
🛢 Brent — $81.20 🔴 -1.10%

📈 Индексы
🇷🇺 IMOEX — 3,482 🟢 +0.50%
🇺🇸 S&P 500 — 6,102 🟢 +0.30%

⏰ 07:00 CET
Источник: Twelve Data
```

---

## 🔑 Получение ключей API

### 1. Telegram Bot Token

1. Откройте Telegram и найдите **[@BotFather](https://t.me/BotFather)**
2. Отправьте команду `/newbot`
3. Введите **имя бота** (например: `My Market Bot`)
4. Введите **username бота** — должен заканчиваться на `bot` (например: `my_market_bot`)
5. BotFather пришлёт токен вида:
   ```
   1234567890:AABBCCDDeeffGGHHIIjjKKllMMnnOOpp
   ```
6. Скопируйте токен в `.env` как `TELEGRAM_BOT_TOKEN`

> ⚠️ Никогда не публикуйте токен бота в открытый доступ!

---

### 2. Telegram Chat ID

#### Вариант A: Личные сообщения боту

1. Найдите **[@userinfobot](https://t.me/userinfobot)** в Telegram
2. Отправьте `/start`
3. Бот пришлёт ваш числовой ID (например: `123456789`)
4. Добавьте своего бота в контакты и отправьте ему любое сообщение
5. Используйте ваш числовой ID как `TELEGRAM_CHAT_ID`

#### Вариант B: Telegram-канал (рекомендуется)

1. Создайте канал в Telegram (публичный или приватный)
2. Добавьте вашего бота в администраторы канала с правом **«Отправка сообщений»**
3. Если канал **публичный**: используйте `@channel_username` как `TELEGRAM_CHAT_ID`
4. Если канал **приватный**: получите числовой ID:
   - Перейдите в **[web.telegram.org](https://web.telegram.org)**
   - Откройте ваш канал
   - В URL найдите цифры после `#-100` — это ваш ID
   - Добавьте `-100` перед числом: `-1001234567890`

#### Вариант C: Группа

1. Добавьте бота в группу
2. Назначьте бота администратором
3. Отправьте любое сообщение в группе
4. Откройте: `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Найдите поле `"chat": {"id": -123456789}` — это ваш Chat ID (отрицательное число)

---

### 3. Twelve Data API Key

1. Перейдите на **[twelvedata.com](https://twelvedata.com)**
2. Нажмите **«Get Free API Key»**
3. Зарегистрируйтесь (email + пароль)
4. После подтверждения email откройте **[Account → API Keys](https://twelvedata.com/account/api-keys)**
5. Скопируйте ваш ключ
6. Добавьте в `.env` как `TWELVE_DATA_API_KEY`

#### Лимиты бесплатного плана:
| Параметр | Значение |
|----------|----------|
| Запросов в день | 800 |
| Запросов в минуту | 8 |
| Использует этот бот | ~8/день |

> Бот укладывается в бесплатный лимит с большим запасом!

> **Важно для IMOEX:** Московская Биржа (`IMOEX:MOEX`) может требовать платный план.
> Если символ недоступен — бот покажет «нет данных» и продолжит работу.

---

## 🚀 Установка и запуск

### Требования

- **Node.js 20+** ([скачать](https://nodejs.org))
- **npm 9+** (идёт вместе с Node.js)

### Шаг 1: Клонировать репозиторий

```bash
git clone <URL_репозитория>
cd telegram-market-bot
```

### Шаг 2: Установить зависимости

```bash
npm install
```

### Шаг 3: Настроить .env

```bash
# Копируем шаблон
cp .env.example .env

# Открываем в редакторе
nano .env
```

Заполните обязательные поля:
```env
TELEGRAM_BOT_TOKEN=1234567890:AABBCCDDeeffGGHHIIjjKKllMMnnOOpp
TELEGRAM_CHAT_ID=@my_channel
TWELVE_DATA_API_KEY=abcdef1234567890
```

### Шаг 4: Тестовый запуск

```bash
# Отправляет сводку сразу + запускает планировщик
RUN_ON_START=true node index.js

# Или через npm script
npm run send-now
```

### Шаг 5: Обычный запуск

```bash
node index.js
```

---

## ⚙️ Деплой на VPS/сервер

### Вариант A: PM2 (рекомендуется)

```bash
# Установка PM2 глобально
npm install -g pm2

# Запуск бота
pm2 start ecosystem.config.js

# Автозапуск при перезагрузке сервера
pm2 startup
# ⚠️ Выполните команду, которую выдаст pm2 startup
pm2 save

# Полезные команды
pm2 status                              # Статус
pm2 logs telegram-market-bot           # Логи в реальном времени
pm2 restart telegram-market-bot        # Перезапуск
pm2 stop telegram-market-bot           # Остановка
pm2 monit                              # Мониторинг CPU/RAM
```

### Вариант B: Docker

```bash
# Запуск через Docker Compose
docker compose up -d

# Логи
docker compose logs -f

# Остановка
docker compose down

# Пересборка после изменений
docker compose up -d --build
```

### Вариант C: systemd

```bash
sudo nano /etc/systemd/system/telegram-market-bot.service
```

```ini
[Unit]
Description=Telegram Market Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/telegram-market-bot
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
EnvironmentFile=/home/ubuntu/telegram-market-bot/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable telegram-market-bot
sudo systemctl start telegram-market-bot
sudo journalctl -u telegram-market-bot -f
```

---

## 🗂️ Структура проекта

```
telegram-market-bot/
│
├── index.js                    # Точка входа, graceful shutdown
├── config/
│   └── index.js                # Конфигурация, символы инструментов
├── services/
│   ├── marketService.js        # Twelve Data API
│   ├── telegramService.js      # Telegram Bot API
│   └── schedulerService.js     # node-cron планировщик
├── utils/
│   ├── formatter.js            # Форматирование HTML-сообщений
│   ├── logger.js               # Логирование (консоль + файл)
│   └── retry.js                # Retry с exponential backoff
├── logs/                       # Файлы логов (auto-created)
├── .env.example                # Шаблон переменных
├── ecosystem.config.js         # PM2 конфигурация
├── Dockerfile
└── docker-compose.yml
```

---

## 🔧 Конфигурация

| Переменная | Обязательна | По умолчанию | Описание |
|------------|-------------|--------------|----------|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Токен бота от @BotFather |
| `TELEGRAM_CHAT_ID` | ✅ | — | ID чата/канала |
| `TWELVE_DATA_API_KEY` | ✅ | — | API-ключ Twelve Data |
| `CRON_EXPRESSION` | ❌ | `0 7 * * *` | Расписание (cron) |
| `RUN_ON_START` | ❌ | `false` | Отправить при старте |
| `API_TIMEOUT_MS` | ❌ | `15000` | Таймаут запросов (мс) |
| `API_RETRIES` | ❌ | `3` | Попыток при ошибке |
| `API_RETRY_DELAY_MS` | ❌ | `2000` | Задержка между попытками |
| `LOG_LEVEL` | ❌ | `info` | Уровень логов |

---

## ➕ Добавление новых инструментов

В `config/index.js` добавьте в `INSTRUMENTS`:

```javascript
silver: {
  symbol: 'XAG/USD',    // Символ Twelve Data
  label: 'Silver',
  emoji: '🥈',
  prefix: '$',
  decimals: 2,
  category: 'commodity',
},
```

В `utils/formatter.js` добавьте строку в нужную секцию:

```javascript
lines.push(formatInstrumentLine(INSTRUMENTS.silver, marketData.silver));
```

---

## 🔍 Символы Twelve Data

| Инструмент | Символ | Тип |
|------------|--------|-----|
| Bitcoin | `BTC/USD` | Crypto |
| Ethereum | `ETH/USD` | Crypto |
| Доллар/Рубль | `USD/RUB` | Forex |
| Евро/Доллар | `EUR/USD` | Forex |
| Золото | `XAU/USD` | Commodity |
| Нефть Brent | `BZ=F` | Futures |
| Индекс МосБиржи | `IMOEX:MOEX` | Index |
| S&P 500 | `SPX` | Index |

Поиск символов: `https://api.twelvedata.com/symbol_search?symbol=IMOEX&apikey=KEY`

---

## 🛠️ Устранение проблем

**"Unauthorized" от Telegram** → неверный `TELEGRAM_BOT_TOKEN`

**"chat not found"** → неверный `TELEGRAM_CHAT_ID` или бот не добавлен в канал/группу

**"Forbidden"** → бот не имеет прав на отправку в канал (назначьте администратором)

**Символ показывает "нет данных"** → символ недоступен на вашем плане Twelve Data.
Проверьте: `https://api.twelvedata.com/quote?symbol=BZ=F&apikey=KEY`

**Превышен лимит API** → код 429. Бесплатный план: 800 запросов/день, бот использует ~8/день.

---

## 📄 Лицензия

MIT License
