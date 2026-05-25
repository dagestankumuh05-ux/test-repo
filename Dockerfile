# ─────────────────────────────────────────────────────────────────────────────
# Dockerfile для Telegram Market Bot
# Multi-stage build для минимального размера образа
# ─────────────────────────────────────────────────────────────────────────────

# ── Стадия 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps

# Устанавливаем зависимости для нативных модулей (если понадобятся)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Копируем только package.json и package-lock.json для кэширования layer
COPY package*.json ./

# Устанавливаем ТОЛЬКО production-зависимости
RUN npm ci --only=production --ignore-scripts && \
    # Удаляем кэш npm для уменьшения размера образа
    npm cache clean --force

# ── Стадия 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS production

# Метаданные образа
LABEL org.opencontainers.image.title="Telegram Market Bot"
LABEL org.opencontainers.image.description="Daily market briefing for Telegram"
LABEL org.opencontainers.image.version="1.0.0"

# Устанавливаем tzdata для корректной работы временных зон
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Europe/Amsterdam /etc/localtime && \
    echo "Europe/Amsterdam" > /etc/timezone

WORKDIR /app

# Копируем node_modules из стадии deps (без devDependencies)
COPY --from=deps /app/node_modules ./node_modules

# Копируем исходный код
COPY index.js ./
COPY config/ ./config/
COPY services/ ./services/
COPY utils/ ./utils/
COPY package.json ./

# Создаём директории для логов и состояния
RUN mkdir -p logs state

# Используем непривилегированного пользователя (безопасность)
# node:20-alpine включает пользователя node (uid=1000)
RUN chown -R node:node /app
USER node

# Переменные окружения (значения задаются через .env или docker-compose)
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Healthcheck: проверяем что процесс жив
# (бот не HTTP-сервер, поэтому проверяем через ps)
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "node index.js" || exit 1

# Запуск бота
CMD ["node", "index.js"]
