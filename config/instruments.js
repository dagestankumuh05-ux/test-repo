/**
 * config/instruments.js
 *
 * Конфигурация торговых инструментов.
 * Вынесено в отдельный файл, чтобы не создавать зависимость
 * от переменных окружения в утилитах форматирования.
 *
 * Символы Twelve Data API:
 *   Crypto:     BTC/USD, ETH/USD
 *   Forex:      USD/RUB, EUR/USD, XAU/USD (золото)
 *   Futures:    BZ=F (Brent Crude Oil)
 *   Indices:    IMOEX:MOEX, SPX
 */

/**
 * Описание каждого торгового инструмента:
 *  - symbol   : точный символ для Twelve Data API
 *  - label    : отображаемое имя в Telegram-сообщении
 *  - emoji    : эмодзи перед названием
 *  - prefix   : префикс цены ($ или пусто)
 *  - decimals : количество знаков после запятой
 *  - category : группа для форматирования сообщения
 */
export const INSTRUMENTS = {
  btc: {
    symbol: 'BTC/USD',
    label: 'BTC',
    emoji: '₿',
    prefix: '$',
    decimals: 0,          // $108,240 — без копеек для биткоина
    category: 'crypto',
  },
  eth: {
    symbol: 'ETH/USD',
    label: 'ETH',
    emoji: 'Ξ',
    prefix: '$',
    decimals: 2,
    category: 'crypto',
  },
  usdRub: {
    symbol: 'USD/RUB',
    label: 'USD/RUB',
    emoji: '💵',
    prefix: '',
    decimals: 2,
    category: 'forex',
  },
  eurUsd: {
    symbol: 'EUR/USD',
    label: 'EUR/USD',
    emoji: '💶',
    prefix: '',
    decimals: 4,
    category: 'forex',
  },
  gold: {
    symbol: 'XAU/USD',
    label: 'Gold',
    emoji: '🥇',
    prefix: '$',
    decimals: 2,
    category: 'commodity',
  },
  brent: {
    symbol: 'BZ=F',       // Brent Crude Oil Futures
    label: 'Brent',
    emoji: '🛢',
    prefix: '$',
    decimals: 2,
    category: 'commodity',
  },
  imoex: {
    symbol: 'IMOEX:MOEX', // Индекс Московской Биржи
    label: 'IMOEX',
    emoji: '🇷🇺',
    prefix: '',
    decimals: 0,
    category: 'index',
  },
  sp500: {
    symbol: 'SPX',        // S&P 500 Index
    label: 'S&P 500',
    emoji: '🇺🇸',
    prefix: '',
    decimals: 0,
    category: 'index',
  },
};
