# 📊 Telegram Market Bot

Простой Telegram-бот на Node.js: каждый день в **07:00 CET** отправляет утреннюю сводку рынков в чат или канал.

**Стек:** Node.js · node-cron · axios · dotenv · Telegram Bot API · Twelve Data API

---

## Пример сообщения

```
📊 Утренний рынок

₿ BTC — $108,240
Ξ ETH — $5,120

💵 USD/RUB — 79.34

🥇 Gold — $3,420
🛢 Brent — $81.20

🇷🇺 MOEX — 3,482
🇺🇸 S&P500 — 6,102

⏰ 07:00 CET
```

---

## Структура проекта

```
telegram-market-bot/
├── index.js       ← весь код бота
├── .env           ← токены и ключи (не коммитить!)
├── .gitignore
├── package.json
└── README.md
```

---

## Инструкция: получить Telegram Bot Token

1. Открой Telegram, найди **@BotFather**
2. Напиши `/newbot`
3. Придумай имя бота (например: `My Market Bot`)
4. Придумай username, оканчивающийся на `bot` (например: `my_market_bot`)
5. BotFather пришлёт токен вида:

   ```
   123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
   ```

6. Скопируй его в `.env` → `TELEGRAM_BOT_TOKEN=`

---

## Инструкция: получить Chat ID

### Вариант A — личный чат или группа

1. Запусти бота: напиши ему `/start` в Telegram
2. Открой в браузере:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
3. В ответе найди поле `"chat": { "id": 123456789 }`
4. Скопируй в `.env` → `TELEGRAM_CHAT_ID=123456789`

> Если `getUpdates` пустой — сначала напиши что-нибудь боту, потом обновляй страницу.

### Вариант B — Telegram-канал

1. Добавь бота в канал как **администратора** с правом на публикацию
2. Перешли любое сообщение из канала боту **@userinfobot**
3. Он покажет ID вида `-1001234567890`
4. Скопируй в `.env` → `TELEGRAM_CHAT_ID=-1001234567890`

---

## Инструкция: получить Twelve Data API Key

1. Зайди на [twelvedata.com](https://twelvedata.com) → **Sign Up** (бесплатно)
2. После регистрации перейди в раздел **Dashboard → API Keys**
3. Скопируй ключ вида `a1b2c3d4e5f6789...`
4. Вставь в `.env` → `TWELVE_DATA_API_KEY=`

> **Лимиты бесплатного плана:** 8 запросов/мин, 800 запросов/сутки.
> Бот делает **1 запрос в день** — лимит не превысить.

---

## Установка и запуск

### 1. Клонируй репозиторий (или просто скопируй файлы на VPS)

```bash
git clone <repo-url>
cd telegram-market-bot
```

### 2. Установи зависимости

```bash
npm install
```

### 3. Заполни `.env`

```bash
nano .env
```

```env
TELEGRAM_BOT_TOKEN=123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
TELEGRAM_CHAT_ID=-1001234567890
TWELVE_DATA_API_KEY=a1b2c3d4e5f6789abcdef
```

### 4. Тест — отправить сообщение прямо сейчас

Раскомментируй последнюю строку в `index.js`:

```js
// Было:
// sendMarketUpdate();

// Стало:
sendMarketUpdate();
```

Запусти:

```bash
node index.js
```

Убедись, что сообщение пришло в Telegram. Потом **закомментируй** строку обратно.

### 5. Запуск в фоне (продакшен)

#### Вариант A — PM2 (рекомендуется)

```bash
# Установить PM2 глобально
npm install -g pm2

# Запустить бота
pm2 start index.js --name market-bot

# Автозапуск при перезагрузке VPS
pm2 startup
pm2 save

# Просмотр логов
pm2 logs market-bot

# Перезапуск / остановка
pm2 restart market-bot
pm2 stop market-bot
```

#### Вариант B — systemd (Linux)

Создай файл `/etc/systemd/system/market-bot.service`:

```ini
[Unit]
Description=Telegram Market Bot
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/path/to/telegram-market-bot
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable market-bot
sudo systemctl start market-bot
sudo systemctl status market-bot
```

#### Вариант C — nohup (самый простой)

```bash
nohup node index.js > bot.log 2>&1 &
echo "PID: $!"

# Смотреть логи
tail -f bot.log
```

---

## Логи

Бот пишет всё в консоль с временными метками:

```
[2024-01-15T07:00:00.123Z] ════════════════════════════════
[2024-01-15T07:00:00.124Z] Запуск утренней сводки рынков...
[2024-01-15T07:00:00.125Z] Запрос к Twelve Data... (попытка 1/3)
[2024-01-15T07:00:01.456Z] Данные получены успешно.
[2024-01-15T07:00:01.457Z] Отправка сообщения в Telegram...
[2024-01-15T07:00:01.890Z] ✅ Сообщение отправлено успешно!
[2024-01-15T07:00:01.891Z] ════════════════════════════════
```

---

## Часто задаваемые вопросы

**Q: Бот молчит, сообщений нет**
A: Проверь `.env`, запусти тест (раскомментируй `sendMarketUpdate()`), смотри логи.

**Q: MOEX показывает N/A**
A: Индекс Мосбиржи может быть недоступен на бесплатном тарифе Twelve Data или закрыт в выходные. Это нормально — остальные данные придут.

**Q: Хочу другое время (не 07:00)**
A: В `index.js` найди строку `cron.schedule('0 7 * * *', ...)` и измени часы. Формат: `'0 ЧАС * * *'`.

**Q: Хочу другой часовой пояс**
A: Измени `timezone: 'Europe/Berlin'` на нужный, например `'Europe/Moscow'` или `'UTC'`.

**Q: Как добавить ещё один инструмент?**
A: Добавь символ в константу `SYMBOLS` (через запятую), добавь строку в `buildMessage()`.
Список символов: [twelvedata.com/symbols](https://twelvedata.com/symbols)

---

## Требования

- Node.js 18+
- npm
- VPS или домашний сервер (любой Linux)
