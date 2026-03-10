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
    this.YTDLP_URL_TIMEOUT = 45000; // 45 секунд (увеличено с 15 для стабильности)
    
    // File Management
    this.TEMP_DIR = './temp'; // Директория для временных файлов
    this.MAX_FILE_SIZE = 2147483648; // 2GB - максимальный размер видео для Telegram (для обычных файлов 50MB)
    this.DOWNLOAD_TIMEOUT = 600000; // 10 минут на скачивание
    this.MERGE_TIMEOUT = 300000; // 5 минут на объединение
    this.CLEANUP_INTERVAL = 3600000; // 1 час - интервал очистки старых файлов
    this.FILE_MAX_AGE = 7200000; // 2 часа - максимальный возраст файла
    
    // File Server для больших файлов
    this.FILE_SERVER_PORT = 3001; // Порт для HTTP сервера файлов
    this.FILE_SERVER_BASE_URL = null; // Базовый URL (если null, то http://localhost:PORT)
    this.LARGE_FILE_TTL_MINUTES = 10; // Время жизни больших файлов в минутах
    this.TELEGRAM_UPLOAD_LIMIT = 524288000; // 500MB - лимит для попытки загрузки в Telegram
    this.TELEGRAM_UPLOAD_TIMEOUT = 600000; // 10 минут - timeout для загрузки в Telegram
    
    // File Server - управление ресурсами
    this.MAX_CONCURRENT_FILES = 50; // Максимум файлов на сервере одновременно
    this.AUTO_DELETE_AFTER_DOWNLOAD = true; // Автоудаление файла после успешного скачивания
    this.MIN_FREE_SPACE_GB = 5; // Минимум свободного места на диске (в GB)
    
    // SponsorBlock интеграция
    this.SPONSORBLOCK_API_URL = 'https://sponsor.ajay.app'; // URL SponsorBlock API
    this.SPONSORBLOCK_ENABLED = true; // Включить SponsorBlock интеграцию
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
    
    // File Management параметры
    if (process.env.TEMP_DIR) {
      this.TEMP_DIR = process.env.TEMP_DIR;
    }
    
    if (process.env.MAX_FILE_SIZE) {
      const size = parseInt(process.env.MAX_FILE_SIZE, 10);
      if (!isNaN(size) && size > 0) {
        this.MAX_FILE_SIZE = size;
      }
    }
    
    if (process.env.DOWNLOAD_TIMEOUT) {
      const timeout = parseInt(process.env.DOWNLOAD_TIMEOUT, 10);
      if (!isNaN(timeout) && timeout > 0) {
        this.DOWNLOAD_TIMEOUT = timeout;
      }
    }
    
    if (process.env.MERGE_TIMEOUT) {
      const timeout = parseInt(process.env.MERGE_TIMEOUT, 10);
      if (!isNaN(timeout) && timeout > 0) {
        this.MERGE_TIMEOUT = timeout;
      }
    }
    
    // File Server параметры
    if (process.env.FILE_SERVER_PORT) {
      const port = parseInt(process.env.FILE_SERVER_PORT, 10);
      if (!isNaN(port) && port > 0) {
        this.FILE_SERVER_PORT = port;
      }
    }
    
    if (process.env.FILE_SERVER_BASE_URL) {
      this.FILE_SERVER_BASE_URL = process.env.FILE_SERVER_BASE_URL;
    }
    
    if (process.env.LARGE_FILE_TTL_MINUTES) {
      const ttl = parseInt(process.env.LARGE_FILE_TTL_MINUTES, 10);
      if (!isNaN(ttl) && ttl > 0) {
        this.LARGE_FILE_TTL_MINUTES = ttl;
      }
    }
    
    if (process.env.TELEGRAM_UPLOAD_LIMIT) {
      const limit = parseInt(process.env.TELEGRAM_UPLOAD_LIMIT, 10);
      if (!isNaN(limit) && limit > 0) {
        this.TELEGRAM_UPLOAD_LIMIT = limit;
      }
    }
    
    if (process.env.TELEGRAM_UPLOAD_TIMEOUT) {
      const timeout = parseInt(process.env.TELEGRAM_UPLOAD_TIMEOUT, 10);
      if (!isNaN(timeout) && timeout > 0) {
        this.TELEGRAM_UPLOAD_TIMEOUT = timeout;
      }
    }
    
    // File Server - управление ресурсами
    if (process.env.MAX_CONCURRENT_FILES) {
      const max = parseInt(process.env.MAX_CONCURRENT_FILES, 10);
      if (!isNaN(max) && max > 0) {
        this.MAX_CONCURRENT_FILES = max;
      }
    }
    
    if (process.env.AUTO_DELETE_AFTER_DOWNLOAD !== undefined) {
      this.AUTO_DELETE_AFTER_DOWNLOAD = process.env.AUTO_DELETE_AFTER_DOWNLOAD === 'true';
    }
    
    if (process.env.MIN_FREE_SPACE_GB) {
      const space = parseFloat(process.env.MIN_FREE_SPACE_GB);
      if (!isNaN(space) && space > 0) {
        this.MIN_FREE_SPACE_GB = space;
      }
    }
    
    // SponsorBlock настройки
    if (process.env.SPONSORBLOCK_API_URL) {
      this.SPONSORBLOCK_API_URL = process.env.SPONSORBLOCK_API_URL;
    }
    
    if (process.env.SPONSORBLOCK_ENABLED !== undefined) {
      this.SPONSORBLOCK_ENABLED = process.env.SPONSORBLOCK_ENABLED === 'true';
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
      YTDLP_URL_TIMEOUT: this.YTDLP_URL_TIMEOUT,
      TEMP_DIR: this.TEMP_DIR,
      MAX_FILE_SIZE: this.MAX_FILE_SIZE,
      DOWNLOAD_TIMEOUT: this.DOWNLOAD_TIMEOUT,
      MERGE_TIMEOUT: this.MERGE_TIMEOUT,
      CLEANUP_INTERVAL: this.CLEANUP_INTERVAL,
      FILE_MAX_AGE: this.FILE_MAX_AGE,
      FILE_SERVER_PORT: this.FILE_SERVER_PORT,
      FILE_SERVER_BASE_URL: this.FILE_SERVER_BASE_URL,
      LARGE_FILE_TTL_MINUTES: this.LARGE_FILE_TTL_MINUTES,
      TELEGRAM_UPLOAD_LIMIT: this.TELEGRAM_UPLOAD_LIMIT,
      TELEGRAM_UPLOAD_TIMEOUT: this.TELEGRAM_UPLOAD_TIMEOUT,
      MAX_CONCURRENT_FILES: this.MAX_CONCURRENT_FILES,
      AUTO_DELETE_AFTER_DOWNLOAD: this.AUTO_DELETE_AFTER_DOWNLOAD,
      MIN_FREE_SPACE_GB: this.MIN_FREE_SPACE_GB,
      SPONSORBLOCK_API_URL: this.SPONSORBLOCK_API_URL,
      SPONSORBLOCK_ENABLED: this.SPONSORBLOCK_ENABLED
    };
  }
}

// Создаем singleton instance
const config = new Config();

module.exports = config;
