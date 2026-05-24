# ────────────────────────────────────────────────────────────────────────────
# Telegram Market Bot — Dockerfile
# Multi-stage build: deps → production image
# ────────────────────────────────────────────────────────────────────────────

# ── Stage 1: установка зависимостей ──────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Копируем только package.json для кэширования слоя
COPY package.json package-lock.json* ./

# Устанавливаем только production-зависимости
RUN npm ci --omit=dev && npm cache clean --force


# ── Stage 2: финальный образ ──────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Метаданные
LABEL maintainer="market-bot"
LABEL description="Daily Telegram market briefing bot"

# Временная зона по умолчанию (переопределяется через .env / TIMEZONE)
ENV TZ=Europe/Amsterdam
RUN apk add --no-cache tzdata

# Рабочая директория
WORKDIR /app

# Не запускать от root
RUN addgroup -S botgroup && adduser -S botuser -G botgroup
RUN mkdir -p /app/logs && chown -R botuser:botgroup /app

# Скопировать зависимости из deps-стадии
COPY --from=deps --chown=botuser:botgroup /app/node_modules ./node_modules

# Скопировать исходный код
COPY --chown=botuser:botgroup . .

# Переключиться на непривилегированного пользователя
USER botuser

# Healthcheck: проверяем что процесс жив
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Точка входа
CMD ["node", "index.js"]
