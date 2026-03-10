const dotenv = require('dotenv');
const path = require('path');

/**
 * Модуль конфигурации приложения
 * Загружает и валидирует переменные окружения
 */
class Config {
  constructor() {
    // Telegram Bot
    this.TELEGRAM_BOT_TOKEN = null;
    
    // Optional: Whitelist пользователей
    this.ALLOWED_USERS = [];
    
    // Optional: Максимальная длительность видео (в секундах)
    this.MAX_VIDEO_DURATION = null;
    
    // Environment
    this.NODE_ENV = 'production';
    
    // Rate Limiting
    this.RATE_LIMIT_MAX_REQUESTS = 5;
    this.RATE_LIMIT_WINDOW_MS = 60000; // 60 секунд
    
    // yt-dlp Timeouts (в миллисекундах)
    this.YTDLP_METADATA_TIMEOUT = 30000; // 30 секунд
    this.YTDLP_URL_TIMEOUT = 15000; // 15 секунд
  }

  /**
   * Загрузка конфигурации из .env файла
   */
  load() {
    // Загружаем .env файл
    const envPath = path.resolve(process.cwd(), '.env');
    const result = dotenv.config({ path: envPath });
    
    if (result.error && process.env.NODE_ENV !== 'test') {
      console.warn('Warning: .env file not found, using environment variables');
    }

    // Загружаем обязательные параметры
    this.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    // Загружаем опциональные параметры с значениями по умолчанию
    this.NODE_ENV = process.env.NODE_ENV || 'production';
    
    // Парсим ALLOWED_USERS (comma-separated list)
    if (process.env.ALLOWED_USERS && process.env.ALLOWED_USERS.trim() !== '') {
      this.ALLOWED_USERS = process.env.ALLOWED_USERS
        .split(',')
        .map(id => id.trim())
        .filter(id => id !== '')
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
    }
    
    // Парсим MAX_VIDEO_DURATION
    if (process.env.MAX_VIDEO_DURATION) {
      const duration = parseInt(process.env.MAX_VIDEO_DURATION, 10);
      if (!isNaN(duration) && duration > 0) {
        this.MAX_VIDEO_DURATION = duration;
      }
    }
    
    // Rate Limiting параметры
    if (process.env.RATE_LIMIT_MAX_REQUESTS) {
      const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10);
      if (!isNaN(maxRequests) && maxRequests > 0) {
        this.RATE_LIMIT_MAX_REQUESTS = maxRequests;
      }
    }
    
    if (process.env.RATE_LIMIT_WINDOW_MS) {
      const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10);
      if (!isNaN(windowMs) && windowMs > 0) {
        this.RATE_LIMIT_WINDOW_MS = windowMs;
      }
    }
    
    // yt-dlp Timeout параметры
    if (process.env.YTDLP_METADATA_TIMEOUT) {
      const timeout = parseInt(process.env.YTDLP_METADATA_TIMEOUT, 10);
      if (!isNaN(timeout) && timeout > 0) {
        this.YTDLP_METADATA_TIMEOUT = timeout;
      }
    }
    
    if (process.env.YTDLP_URL_TIMEOUT) {
      const timeout = parseInt(process.env.YTDLP_URL_TIMEOUT, 10);
      if (!isNaN(timeout) && timeout > 0) {
        this.YTDLP_URL_TIMEOUT = timeout;
      }
    }
  }

  /**
   * Валидация обязательных параметров конфигурации
   * @throws {Error} Если обязательные параметры отсутствуют
   */
  validate() {
    const errors = [];

    // Проверка обязательных параметров
    if (!this.TELEGRAM_BOT_TOKEN || this.TELEGRAM_BOT_TOKEN.trim() === '') {
      errors.push('TELEGRAM_BOT_TOKEN is required');
    }

    // Валидация формата токена (базовая проверка)
    if (this.TELEGRAM_BOT_TOKEN && !this.isValidBotToken(this.TELEGRAM_BOT_TOKEN)) {
      errors.push('TELEGRAM_BOT_TOKEN has invalid format');
    }

    // Валидация числовых параметров
    if (this.RATE_LIMIT_MAX_REQUESTS <= 0) {
      errors.push('RATE_LIMIT_MAX_REQUESTS must be greater than 0');
    }

    if (this.RATE_LIMIT_WINDOW_MS <= 0) {
      errors.push('RATE_LIMIT_WINDOW_MS must be greater than 0');
    }

    if (this.YTDLP_METADATA_TIMEOUT <= 0) {
      errors.push('YTDLP_METADATA_TIMEOUT must be greater than 0');
    }

    if (this.YTDLP_URL_TIMEOUT <= 0) {
      errors.push('YTDLP_URL_TIMEOUT must be greater than 0');
    }

    // Если есть ошибки, выбрасываем исключение
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Базовая валидация формата Telegram Bot Token
   * Формат: число:строка (например, 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
   * @param {string} token
   * @returns {boolean}
   */
  isValidBotToken(token) {
    if (typeof token !== 'string') return false;
    
    // Telegram bot token имеет формат: <bot_id>:<token>
    // bot_id - это число, token - это строка из букв, цифр, дефисов и подчеркиваний
    const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
    return tokenPattern.test(token);
  }

  /**
   * Получение всей конфигурации в виде объекта
   * @returns {Object}
   */
  getAll() {
    return {
      TELEGRAM_BOT_TOKEN: this.TELEGRAM_BOT_TOKEN,
      ALLOWED_USERS: this.ALLOWED_USERS,
      MAX_VIDEO_DURATION: this.MAX_VIDEO_DURATION,
      NODE_ENV: this.NODE_ENV,
      RATE_LIMIT_MAX_REQUESTS: this.RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_MS: this.RATE_LIMIT_WINDOW_MS,
      YTDLP_METADATA_TIMEOUT: this.YTDLP_METADATA_TIMEOUT,
      YTDLP_URL_TIMEOUT: this.YTDLP_URL_TIMEOUT
    };
  }
}

// Создаем singleton instance
const config = new Config();

module.exports = config;
