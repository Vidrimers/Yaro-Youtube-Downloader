// Mock dotenv для контроля загрузки переменных окружения
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

const Config = require('./config');
const dotenv = require('dotenv');

describe('Config Module', () => {
  let originalEnv;

  beforeEach(() => {
    // Сохраняем оригинальные переменные окружения
    originalEnv = { ...process.env };
    
    // Очищаем mock
    dotenv.config.mockClear();
    dotenv.config.mockReturnValue({ parsed: {} });
    
    // Очищаем конфигурацию перед каждым тестом
    Config.TELEGRAM_BOT_TOKEN = null;
    Config.ALLOWED_USERS = [];
    Config.MAX_VIDEO_DURATION = null;
    Config.NODE_ENV = 'production';
    Config.RATE_LIMIT_MAX_REQUESTS = 5;
    Config.RATE_LIMIT_WINDOW_MS = 60000;
    Config.YTDLP_METADATA_TIMEOUT = 30000;
    Config.YTDLP_URL_TIMEOUT = 15000;
    Config.FILE_SERVER_PORT = 3001;
    Config.FILE_SERVER_BASE_URL = null;
    Config.LARGE_FILE_TTL_MINUTES = 10;
    Config.TELEGRAM_UPLOAD_LIMIT = 524288000;
    Config.TELEGRAM_UPLOAD_TIMEOUT = 600000;
  });

  afterEach(() => {
    // Восстанавливаем оригинальные переменные окружения
    process.env = originalEnv;
  });

  describe('validate()', () => {
    test('должен выбросить ошибку при отсутствии TELEGRAM_BOT_TOKEN', () => {
      // Arrange
      Config.TELEGRAM_BOT_TOKEN = null;

      // Act & Assert
      expect(() => Config.validate()).toThrow('TELEGRAM_BOT_TOKEN is required');
    });

    test('должен выбросить ошибку при пустом TELEGRAM_BOT_TOKEN', () => {
      // Arrange
      Config.TELEGRAM_BOT_TOKEN = '   ';

      // Act & Assert
      expect(() => Config.validate()).toThrow('TELEGRAM_BOT_TOKEN is required');
    });

    test('должен выбросить ошибку при невалидном формате TELEGRAM_BOT_TOKEN', () => {
      // Arrange
      Config.TELEGRAM_BOT_TOKEN = 'invalid_token_format';

      // Act & Assert
      expect(() => Config.validate()).toThrow('TELEGRAM_BOT_TOKEN has invalid format');
    });

    test('должен пройти валидацию с валидным токеном', () => {
      // Arrange
      Config.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz-123';

      // Act & Assert
      expect(() => Config.validate()).not.toThrow();
    });

    test('должен выбросить ошибку при невалидных числовых параметрах', () => {
      // Arrange
      Config.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      Config.RATE_LIMIT_MAX_REQUESTS = 0;

      // Act & Assert
      expect(() => Config.validate()).toThrow('RATE_LIMIT_MAX_REQUESTS must be greater than 0');
    });
  });

  describe('load()', () => {
    test('должен загрузить все параметры из переменных окружения', () => {
      // Arrange
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      process.env.NODE_ENV = 'development';
      process.env.ALLOWED_USERS = '111,222,333';
      process.env.MAX_VIDEO_DURATION = '7200';
      process.env.RATE_LIMIT_MAX_REQUESTS = '10';
      process.env.RATE_LIMIT_WINDOW_MS = '120000';
      process.env.YTDLP_METADATA_TIMEOUT = '45000';
      process.env.YTDLP_URL_TIMEOUT = '20000';

      // Act
      Config.load();

      // Assert
      expect(Config.TELEGRAM_BOT_TOKEN).toBe('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
      expect(Config.NODE_ENV).toBe('development');
      expect(Config.ALLOWED_USERS).toEqual([111, 222, 333]);
      expect(Config.MAX_VIDEO_DURATION).toBe(7200);
      expect(Config.RATE_LIMIT_MAX_REQUESTS).toBe(10);
      expect(Config.RATE_LIMIT_WINDOW_MS).toBe(120000);
      expect(Config.YTDLP_METADATA_TIMEOUT).toBe(45000);
      expect(Config.YTDLP_URL_TIMEOUT).toBe(20000);
    });

    test('должен использовать значения по умолчанию для опциональных параметров', () => {
      // Arrange
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      // Не устанавливаем опциональные параметры
      delete process.env.NODE_ENV;
      delete process.env.ALLOWED_USERS;
      delete process.env.MAX_VIDEO_DURATION;
      delete process.env.RATE_LIMIT_MAX_REQUESTS;
      delete process.env.RATE_LIMIT_WINDOW_MS;
      delete process.env.YTDLP_METADATA_TIMEOUT;
      delete process.env.YTDLP_URL_TIMEOUT;

      // Act
      Config.load();

      // Assert
      expect(Config.NODE_ENV).toBe('production'); // значение по умолчанию
      expect(Config.ALLOWED_USERS).toEqual([]); // пустой массив по умолчанию
      expect(Config.MAX_VIDEO_DURATION).toBeNull(); // null по умолчанию
      expect(Config.RATE_LIMIT_MAX_REQUESTS).toBe(5); // значение по умолчанию
      expect(Config.RATE_LIMIT_WINDOW_MS).toBe(60000); // значение по умолчанию
      expect(Config.YTDLP_METADATA_TIMEOUT).toBe(30000); // значение по умолчанию
      expect(Config.YTDLP_URL_TIMEOUT).toBe(15000); // значение по умолчанию
      expect(Config.FILE_SERVER_PORT).toBe(3001); // значение по умолчанию
      expect(Config.FILE_SERVER_BASE_URL).toBeNull(); // null по умолчанию
      expect(Config.LARGE_FILE_TTL_MINUTES).toBe(10); // значение по умолчанию
      expect(Config.TELEGRAM_UPLOAD_LIMIT).toBe(524288000); // 500MB по умолчанию
      expect(Config.TELEGRAM_UPLOAD_TIMEOUT).toBe(600000); // 10 минут по умолчанию
    });

    test('должен корректно парсить ALLOWED_USERS с пробелами', () => {
      // Arrange
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      process.env.ALLOWED_USERS = ' 111 , 222 , 333 ';

      // Act
      Config.load();

      // Assert
      expect(Config.ALLOWED_USERS).toEqual([111, 222, 333]);
    });

    test('должен игнорировать невалидные значения в ALLOWED_USERS', () => {
      // Arrange
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      process.env.ALLOWED_USERS = '111,abc,222,xyz,333';

      // Act
      Config.load();

      // Assert
      expect(Config.ALLOWED_USERS).toEqual([111, 222, 333]);
    });

    test('должен вернуть пустой массив для пустого ALLOWED_USERS', () => {
      // Arrange
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      process.env.ALLOWED_USERS = '';

      // Act
      Config.load();

      // Assert
      expect(Config.ALLOWED_USERS).toEqual([]);
    });

    test('должен игнорировать невалидные числовые значения', () => {
      // Arrange
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      process.env.MAX_VIDEO_DURATION = 'invalid';
      process.env.RATE_LIMIT_MAX_REQUESTS = 'abc';

      // Act
      Config.load();

      // Assert
      expect(Config.MAX_VIDEO_DURATION).toBeNull(); // остается null
      expect(Config.RATE_LIMIT_MAX_REQUESTS).toBe(5); // остается значение по умолчанию
    });

    test('должен игнорировать отрицательные числовые значения', () => {
      // Arrange
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      process.env.MAX_VIDEO_DURATION = '-100';
      process.env.RATE_LIMIT_MAX_REQUESTS = '-5';

      // Act
      Config.load();

      // Assert
      expect(Config.MAX_VIDEO_DURATION).toBeNull(); // остается null
      expect(Config.RATE_LIMIT_MAX_REQUESTS).toBe(5); // остается значение по умолчанию
    });
  });

  describe('isValidBotToken()', () => {
    test('должен вернуть true для валидного токена', () => {
      expect(Config.isValidBotToken('123456789:ABCdefGHIjklMNOpqrsTUVwxyz')).toBe(true);
      expect(Config.isValidBotToken('987654321:XYZ-abc_123')).toBe(true);
    });

    test('должен вернуть false для невалидного токена', () => {
      expect(Config.isValidBotToken('invalid')).toBe(false);
      expect(Config.isValidBotToken('123456789')).toBe(false);
      expect(Config.isValidBotToken(':ABCdefGHI')).toBe(false);
      expect(Config.isValidBotToken('123:ABC:DEF')).toBe(false);
      expect(Config.isValidBotToken('')).toBe(false);
    });

    test('должен вернуть false для не-строковых значений', () => {
      expect(Config.isValidBotToken(null)).toBe(false);
      expect(Config.isValidBotToken(undefined)).toBe(false);
      expect(Config.isValidBotToken(123)).toBe(false);
    });
  });

  describe('getAll()', () => {
    test('должен вернуть объект со всеми параметрами конфигурации', () => {
      // Arrange
      Config.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      Config.NODE_ENV = 'development';
      Config.ALLOWED_USERS = [111, 222];
      Config.MAX_VIDEO_DURATION = 3600;
      Config.YTDLP_URL_TIMEOUT = 45000; // Устанавливаем новое значение

      // Act
      const config = Config.getAll();

      // Assert
      expect(config).toEqual({
        TELEGRAM_BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
        ALLOWED_USERS: [111, 222],
        MAX_VIDEO_DURATION: 3600,
        NODE_ENV: 'development',
        RATE_LIMIT_MAX_REQUESTS: 5,
        RATE_LIMIT_WINDOW_MS: 60000,
        YTDLP_METADATA_TIMEOUT: 30000,
        YTDLP_URL_TIMEOUT: 45000, // Обновлено значение
        TEMP_DIR: './temp',
        MAX_FILE_SIZE: 2147483648,
        DOWNLOAD_TIMEOUT: 600000,
        MERGE_TIMEOUT: 300000,
        CLEANUP_INTERVAL: 3600000,
        FILE_MAX_AGE: 7200000,
        FILE_SERVER_PORT: 3001,
        FILE_SERVER_BASE_URL: null,
        LARGE_FILE_TTL_MINUTES: 10,
        TELEGRAM_UPLOAD_LIMIT: 524288000, // 500MB
        TELEGRAM_UPLOAD_TIMEOUT: 600000, // 10 минут
        // Новые параметры
        AUTO_DELETE_AFTER_DOWNLOAD: true,
        DONATION_ALERTS_URL: "https://dalink.to/v1drimers",
        KASPA_ADDRESS: null,
        KASPA_API_URL: "https://api.kaspa.org",
        MAX_CONCURRENT_FILES: 50,
        MIN_FREE_SPACE_GB: 5,
        SPONSORBLOCK_API_URL: "https://sponsor.ajay.app",
        SPONSORBLOCK_ENABLED: true,
        TELEGRAM_ADMIN_ID: null,
        TELEGRAM_API_BASE_DELAY: 1000,
        TELEGRAM_API_MAX_DELAY: 10000,
        TELEGRAM_API_MAX_RETRIES: 3,
        TON_ADDRESS: null,
        TON_API_URL: "https://toncenter.com/api/v2",
        TRON_API_KEY: null,
        TRON_API_URL: "https://api.trongrid.io",
        USDT_ADDRESS: null
      });
    });
  });

  describe('Integration: load() + validate()', () => {
    test('должен успешно загрузить и валидировать корректную конфигурацию', () => {
      // Arrange
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      process.env.NODE_ENV = 'production';

      // Act
      Config.load();

      // Assert
      expect(() => Config.validate()).not.toThrow();
    });

    test('должен выбросить ошибку при загрузке конфигурации без токена', () => {
      // Arrange
      // Очищаем все переменные окружения, связанные с конфигурацией
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.NODE_ENV;
      delete process.env.ALLOWED_USERS;
      delete process.env.MAX_VIDEO_DURATION;
      delete process.env.RATE_LIMIT_MAX_REQUESTS;
      delete process.env.RATE_LIMIT_WINDOW_MS;
      delete process.env.YTDLP_METADATA_TIMEOUT;
      delete process.env.YTDLP_URL_TIMEOUT;

      // Act
      Config.load();

      // Assert
      expect(() => Config.validate()).toThrow('TELEGRAM_BOT_TOKEN is required');
    });
  });
});
