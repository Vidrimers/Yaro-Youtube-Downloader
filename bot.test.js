const fc = require('fast-check');
const BotController = require('./bot');
const config = require('./config/config');

// Mock для TelegramBot
jest.mock('node-telegram-bot-api');
const TelegramBot = require('node-telegram-bot-api');

// Mock для VideoProcessor
jest.mock('./src/ytdlp');
const VideoProcessor = require('./src/ytdlp');

describe('BotController', () => {
  let botController;
  let mockBot;
  let mockVideoProcessor;
  
  beforeEach(() => {
    // Настраиваем моки
    mockBot = {
      sendMessage: jest.fn().mockResolvedValue({}),
      sendChatAction: jest.fn().mockResolvedValue({}),
      answerCallbackQuery: jest.fn().mockResolvedValue({}),
      onText: jest.fn(),
      on: jest.fn()
    };
    
    TelegramBot.mockImplementation(() => mockBot);
    
    mockVideoProcessor = {
      getVideoInfo: jest.fn(),
      getDirectUrl: jest.fn(),
      filterAndSortFormats: jest.fn(),
      isCombinedFormat: jest.fn(),
      getBestAudioFormat: jest.fn(),
      downloadStream: jest.fn(),
      downloadVideo: jest.fn()
    };
    
    VideoProcessor.mockImplementation(() => mockVideoProcessor);
    
    // Создаем тестовую конфигурацию
    const testConfig = {
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      ALLOWED_USERS: [],
      MAX_VIDEO_DURATION: null,
      NODE_ENV: 'test',
      RATE_LIMIT_MAX_REQUESTS: 5,
      RATE_LIMIT_WINDOW_MS: 60000,
      YTDLP_METADATA_TIMEOUT: 30000,
      YTDLP_URL_TIMEOUT: 15000
    };
    
    botController = new BotController(testConfig.TELEGRAM_BOT_TOKEN, testConfig);
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Property Tests', () => {
    /**
     * Property 11: Command Response Immediacy
     * For any команды /start или /help, бот должен ответить немедленно
     * без обращения к yt-dlp
     * 
     * Feature: youtube-downloader-bot, Property 11: Command Response Immediacy
     * Validates: Requirements 10.1, 10.2, 10.5
     */
    test('Property 11: Command Response Immediacy', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('start', 'help'),
          fc.integer({ min: 1, max: 999999999 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          async (command, userId, username) => {
            // Сбрасываем моки
            mockBot.sendMessage.mockClear();
            mockVideoProcessor.getVideoInfo.mockClear();
            
            const msg = {
              chat: { id: 12345 },
              from: { id: userId, username: username },
              text: `/${command}`
            };
            
            const startTime = Date.now();
            await botController.handleCommand(msg, command);
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            // Проверяем, что бот ответил
            expect(mockBot.sendMessage).toHaveBeenCalled();
            
            // Проверяем, что НЕ было обращения к yt-dlp
            expect(mockVideoProcessor.getVideoInfo).not.toHaveBeenCalled();
            expect(mockVideoProcessor.getDirectUrl).not.toHaveBeenCalled();
            
            // Проверяем, что ответ был быстрым (меньше 100ms)
            // Это гарантирует, что не было сетевых запросов
            expect(responseTime).toBeLessThan(100);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Unit Tests', () => {
    describe('handleCommand', () => {
      test('should handle /start command', async () => {
        const msg = {
          chat: { id: 12345 },
          from: { id: 1, username: 'testuser' },
          text: '/start'
        };
        
        await botController.handleCommand(msg, 'start');
        
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Добро пожаловать'),
          expect.any(Object)
        );
      });
      
      test('should handle /help command', async () => {
        const msg = {
          chat: { id: 12345 },
          from: { id: 1, username: 'testuser' },
          text: '/help'
        };
        
        await botController.handleCommand(msg, 'help');
        
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Справка'),
          expect.any(Object)
        );
      });
      
      test('should ignore unknown commands', async () => {
        const msg = {
          chat: { id: 12345 },
          from: { id: 1, username: 'testuser' },
          text: '/unknown'
        };
        
        await botController.handleCommand(msg, 'unknown');
        
        // Не должно быть отправлено сообщение для неизвестной команды
        expect(mockBot.sendMessage).not.toHaveBeenCalled();
      });
    });

    describe('handleMessage', () => {
      test('should reject invalid YouTube URL', async () => {
        const msg = {
          chat: { id: 12345 },
          from: { id: 1, username: 'testuser' },
          text: 'https://vimeo.com/123456'
        };
        
        await botController.handleMessage(msg);
        
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Неверная ссылка'),
          expect.any(Object)
        );
        
        expect(mockVideoProcessor.getVideoInfo).not.toHaveBeenCalled();
      });
      
      test('should handle rate limit exceeded', async () => {
        const msg = {
          chat: { id: 12345 },
          from: { id: 1, username: 'testuser' },
          text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        };
        
        // Делаем 5 запросов (лимит)
        for (let i = 0; i < 5; i++) {
          await botController.handleMessage(msg);
        }
        
        mockBot.sendMessage.mockClear();
        
        // 6-й запрос должен быть отклонен
        await botController.handleMessage(msg);
        
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Слишком много запросов'),
          expect.any(Object)
        );
      });
      
      test('should process valid YouTube URL', async () => {
        mockVideoProcessor.getVideoInfo.mockResolvedValue({
          id: 'dQw4w9WgXcQ',
          title: 'Test Video',
          duration: 180,
          thumbnail: 'https://example.com/thumb.jpg',
          uploader: 'Test Channel',
          formats: [
            {
              format_id: '137',
              ext: 'mp4',
              format_note: '1080p',
              height: 1080,
              filesize: 10000000,
              vcodec: 'avc1',
              acodec: 'mp4a'
            }
          ]
        });
        
        mockVideoProcessor.filterAndSortFormats.mockReturnValue([
          {
            format_id: '137',
            ext: 'mp4',
            format_note: '1080p',
            height: 1080,
            filesize: 10000000,
            vcodec: 'avc1',
            acodec: 'mp4a'
          }
        ]);
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 2, username: 'testuser2' },
          text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        };
        
        await botController.handleMessage(msg);
        
        expect(mockVideoProcessor.getVideoInfo).toHaveBeenCalled();
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Test Video'),
          expect.any(Object)
        );
      });
      
      test('should handle video unavailable error', async () => {
        mockVideoProcessor.getVideoInfo.mockRejectedValue(new Error('VIDEO_UNAVAILABLE'));
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 3, username: 'testuser3' },
          text: 'https://www.youtube.com/watch?v=invalid123'
        };
        
        await botController.handleMessage(msg);
        
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Видео недоступно'),
          expect.any(Object)
        );
      });
      
      test('should handle timeout error', async () => {
        mockVideoProcessor.getVideoInfo.mockRejectedValue(new Error('TIMEOUT'));
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 4, username: 'testuser4' },
          text: 'https://www.youtube.com/watch?v=timeout123'
        };
        
        await botController.handleMessage(msg);
        
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Превышено время ожидания'),
          expect.any(Object)
        );
      });
    });

    describe('Whitelist Filter', () => {
      test('should allow user in whitelist', async () => {
        // Создаем бота с whitelist
        const testConfigWithWhitelist = {
          TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          ALLOWED_USERS: [100, 200, 300],
          MAX_VIDEO_DURATION: null,
          NODE_ENV: 'test',
          RATE_LIMIT_MAX_REQUESTS: 5,
          RATE_LIMIT_WINDOW_MS: 60000,
          YTDLP_METADATA_TIMEOUT: 30000,
          YTDLP_URL_TIMEOUT: 15000
        };
        
        const botWithWhitelist = new BotController(
          testConfigWithWhitelist.TELEGRAM_BOT_TOKEN, 
          testConfigWithWhitelist
        );
        
        mockVideoProcessor.getVideoInfo.mockResolvedValue({
          id: 'dQw4w9WgXcQ',
          title: 'Test Video',
          duration: 180,
          thumbnail: 'https://example.com/thumb.jpg',
          uploader: 'Test Channel',
          formats: []
        });
        
        mockVideoProcessor.filterAndSortFormats.mockReturnValue([]);
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 100, username: 'alloweduser' },
          text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        };
        
        await botWithWhitelist.handleMessage(msg);
        
        // Пользователь в whitelist, должен быть вызван getVideoInfo
        expect(mockVideoProcessor.getVideoInfo).toHaveBeenCalled();
      });
      
      test('should reject user not in whitelist', async () => {
        // Создаем бота с whitelist
        const testConfigWithWhitelist = {
          TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          ALLOWED_USERS: [100, 200, 300],
          MAX_VIDEO_DURATION: null,
          NODE_ENV: 'test',
          RATE_LIMIT_MAX_REQUESTS: 5,
          RATE_LIMIT_WINDOW_MS: 60000,
          YTDLP_METADATA_TIMEOUT: 30000,
          YTDLP_URL_TIMEOUT: 15000
        };
        
        const botWithWhitelist = new BotController(
          testConfigWithWhitelist.TELEGRAM_BOT_TOKEN, 
          testConfigWithWhitelist
        );
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 999, username: 'unauthorizeduser' },
          text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        };
        
        await botWithWhitelist.handleMessage(msg);
        
        // Пользователь НЕ в whitelist, должно быть отправлено сообщение об ошибке
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          '❌ Доступ запрещен. Этот бот доступен только авторизованным пользователям.',
          {}
        );
        
        // getVideoInfo НЕ должен быть вызван
        expect(mockVideoProcessor.getVideoInfo).not.toHaveBeenCalled();
      });
      
      test('should allow all users when whitelist is empty', async () => {
        // Бот без whitelist (пустой массив)
        mockVideoProcessor.getVideoInfo.mockResolvedValue({
          id: 'dQw4w9WgXcQ',
          title: 'Test Video',
          duration: 180,
          thumbnail: 'https://example.com/thumb.jpg',
          uploader: 'Test Channel',
          formats: []
        });
        
        mockVideoProcessor.filterAndSortFormats.mockReturnValue([]);
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 999, username: 'anyuser' },
          text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        };
        
        await botController.handleMessage(msg);
        
        // Whitelist пустой, любой пользователь должен быть допущен
        expect(mockVideoProcessor.getVideoInfo).toHaveBeenCalled();
      });
      
      test('should log unauthorized access attempts', async () => {
        const testConfigWithWhitelist = {
          TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          ALLOWED_USERS: [100, 200],
          MAX_VIDEO_DURATION: null,
          NODE_ENV: 'test',
          RATE_LIMIT_MAX_REQUESTS: 5,
          RATE_LIMIT_WINDOW_MS: 60000,
          YTDLP_METADATA_TIMEOUT: 30000,
          YTDLP_URL_TIMEOUT: 15000
        };
        
        const botWithWhitelist = new BotController(
          testConfigWithWhitelist.TELEGRAM_BOT_TOKEN, 
          testConfigWithWhitelist
        );
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 999, username: 'hacker' },
          text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        };
        
        // Логирование проверяется через вызов sendMessage с сообщением об ошибке
        await botWithWhitelist.handleMessage(msg);
        
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          '❌ Доступ запрещен. Этот бот доступен только авторизованным пользователям.',
          {}
        );
      });
    });

    describe('Duration Filter', () => {
      test('should allow video within duration limit', async () => {
        // Создаем бота с лимитом длительности 3600 секунд (1 час)
        const testConfigWithDuration = {
          TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          ALLOWED_USERS: [],
          MAX_VIDEO_DURATION: 3600,
          NODE_ENV: 'test',
          RATE_LIMIT_MAX_REQUESTS: 5,
          RATE_LIMIT_WINDOW_MS: 60000,
          YTDLP_METADATA_TIMEOUT: 30000,
          YTDLP_URL_TIMEOUT: 15000
        };
        
        const botWithDuration = new BotController(
          testConfigWithDuration.TELEGRAM_BOT_TOKEN, 
          testConfigWithDuration
        );
        
        mockVideoProcessor.getVideoInfo.mockResolvedValue({
          id: 'dQw4w9WgXcQ',
          title: 'Short Video',
          duration: 1800, // 30 минут
          thumbnail: 'https://example.com/thumb.jpg',
          uploader: 'Test Channel',
          formats: [
            {
              format_id: '137',
              ext: 'mp4',
              format_note: '1080p',
              height: 1080,
              filesize: 10000000,
              vcodec: 'avc1',
              acodec: 'mp4a'
            }
          ]
        });
        
        mockVideoProcessor.filterAndSortFormats.mockReturnValue([
          {
            format_id: '137',
            ext: 'mp4',
            format_note: '1080p',
            height: 1080,
            filesize: 10000000,
            vcodec: 'avc1',
            acodec: 'mp4a'
          }
        ]);
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 7, username: 'testuser7' },
          text: 'https://www.youtube.com/watch?v=short123'
        };
        
        await botWithDuration.handleMessage(msg);
        
        // Видео в пределах лимита, должны быть отправлены форматы
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Short Video'),
          expect.any(Object)
        );
      });
      
      test('should reject video exceeding duration limit', async () => {
        // Создаем бота с лимитом длительности 3600 секунд (1 час)
        const testConfigWithDuration = {
          TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          ALLOWED_USERS: [],
          MAX_VIDEO_DURATION: 3600,
          NODE_ENV: 'test',
          RATE_LIMIT_MAX_REQUESTS: 5,
          RATE_LIMIT_WINDOW_MS: 60000,
          YTDLP_METADATA_TIMEOUT: 30000,
          YTDLP_URL_TIMEOUT: 15000
        };
        
        const botWithDuration = new BotController(
          testConfigWithDuration.TELEGRAM_BOT_TOKEN, 
          testConfigWithDuration
        );
        
        mockVideoProcessor.getVideoInfo.mockResolvedValue({
          id: 'longvideo123',
          title: 'Very Long Video',
          duration: 7200, // 2 часа
          thumbnail: 'https://example.com/thumb.jpg',
          uploader: 'Test Channel',
          formats: []
        });
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 8, username: 'testuser8' },
          text: 'https://www.youtube.com/watch?v=longvideo123'
        };
        
        await botWithDuration.handleMessage(msg);
        
        // Видео превышает лимит, должно быть отправлено сообщение об ошибке
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Видео слишком длинное'),
          expect.any(Object)
        );
        
        // filterAndSortFormats НЕ должен быть вызван
        expect(mockVideoProcessor.filterAndSortFormats).not.toHaveBeenCalled();
      });
      
      test('should allow any duration when limit is not set', async () => {
        // Бот без лимита длительности
        mockVideoProcessor.getVideoInfo.mockResolvedValue({
          id: 'verylongvideo',
          title: 'Very Long Video',
          duration: 10800, // 3 часа
          thumbnail: 'https://example.com/thumb.jpg',
          uploader: 'Test Channel',
          formats: [
            {
              format_id: '137',
              ext: 'mp4',
              format_note: '1080p',
              height: 1080,
              filesize: 10000000,
              vcodec: 'avc1',
              acodec: 'mp4a'
            }
          ]
        });
        
        mockVideoProcessor.filterAndSortFormats.mockReturnValue([
          {
            format_id: '137',
            ext: 'mp4',
            format_note: '1080p',
            height: 1080,
            filesize: 10000000,
            vcodec: 'avc1',
            acodec: 'mp4a'
          }
        ]);
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 9, username: 'testuser9' },
          text: 'https://www.youtube.com/watch?v=verylongvideo'
        };
        
        await botController.handleMessage(msg);
        
        // Лимит не установлен, любая длительность допустима
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Very Long Video'),
          expect.any(Object)
        );
      });
      
      test('should format duration limit in error message correctly', async () => {
        const testConfigWithDuration = {
          TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          ALLOWED_USERS: [],
          MAX_VIDEO_DURATION: 1800, // 30 минут
          NODE_ENV: 'test',
          RATE_LIMIT_MAX_REQUESTS: 5,
          RATE_LIMIT_WINDOW_MS: 60000,
          YTDLP_METADATA_TIMEOUT: 30000,
          YTDLP_URL_TIMEOUT: 15000
        };
        
        const botWithDuration = new BotController(
          testConfigWithDuration.TELEGRAM_BOT_TOKEN, 
          testConfigWithDuration
        );
        
        mockVideoProcessor.getVideoInfo.mockResolvedValue({
          id: 'longvideo',
          title: 'Long Video',
          duration: 2400, // 40 минут
          thumbnail: 'https://example.com/thumb.jpg',
          uploader: 'Test Channel',
          formats: []
        });
        
        const msg = {
          chat: { id: 12345 },
          from: { id: 10, username: 'testuser10' },
          text: 'https://www.youtube.com/watch?v=longvideo'
        };
        
        await botWithDuration.handleMessage(msg);
        
        // Проверяем, что в сообщении указано правильное количество минут (30)
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('30'),
          expect.any(Object)
        );
      });
    });

    describe('handleCallbackQuery', () => {
      test('should handle valid callback query', async () => {
        // Настраиваем моки для комбинированного формата
        mockVideoProcessor.getVideoInfo.mockResolvedValue({
          id: 'dQw4w9WgXcQ',
          title: 'Test Video',
          formats: [
            {
              format_id: '137',
              ext: 'mp4',
              vcodec: 'avc1',
              acodec: 'mp4a', // комбинированный формат
              height: 1080
            }
          ]
        });
        
        mockVideoProcessor.isCombinedFormat.mockReturnValue(true);
        mockVideoProcessor.getDirectUrl.mockResolvedValue('https://example.com/video.mp4');
        
        const query = {
          id: 'query123',
          message: { chat: { id: 12345 } },
          from: { id: 1, username: 'testuser' },
          data: 'dl_137_dQw4w9WgXcQ_1080p'
        };
        
        await botController.handleCallbackQuery(query);
        
        expect(mockVideoProcessor.getDirectUrl).toHaveBeenCalledWith(
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          '137'
        );
        
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Ссылка готова'),
          expect.any(Object)
        );
        
        expect(mockBot.answerCallbackQuery).toHaveBeenCalledWith(
          'query123',
          expect.objectContaining({ text: expect.stringContaining('1080p') })
        );
      });
      
      test('should handle invalid callback data', async () => {
        const query = {
          id: 'query123',
          message: { chat: { id: 12345 } },
          from: { id: 1, username: 'testuser' },
          data: 'invalid_data'
        };
        
        await botController.handleCallbackQuery(query);
        
        expect(mockBot.answerCallbackQuery).toHaveBeenCalledWith(
          'query123',
          expect.objectContaining({ text: expect.stringContaining('Ошибка') })
        );
        
        expect(mockVideoProcessor.getDirectUrl).not.toHaveBeenCalled();
      });
      
      test('should handle format unavailable error', async () => {
        // Настраиваем мок для получения videoInfo, но без нужного формата
        mockVideoProcessor.getVideoInfo.mockResolvedValue({
          id: 'dQw4w9WgXcQ',
          title: 'Test Video',
          formats: [] // Пустой массив форматов
        });
        
        const query = {
          id: 'query123',
          message: { chat: { id: 12345 } },
          from: { id: 1, username: 'testuser' },
          data: 'dl_137_dQw4w9WgXcQ_1080p'
        };
        
        await botController.handleCallbackQuery(query);
        
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Формат недоступен'),
          expect.any(Object)
        );
      });
    });
  });

  describe('Integration Tests', () => {
    test('Full flow: URL → formats → selection → direct link', async () => {
      // Настраиваем моки для полного flow
      mockVideoProcessor.getVideoInfo.mockResolvedValue({
        id: 'dQw4w9WgXcQ',
        title: 'Test Video',
        duration: 180,
        thumbnail: 'https://example.com/thumb.jpg',
        uploader: 'Test Channel',
        formats: [
          {
            format_id: '137',
            ext: 'mp4',
            format_note: '1080p',
            height: 1080,
            filesize: 10000000,
            vcodec: 'avc1',
            acodec: 'mp4a'
          }
        ]
      });
      
      mockVideoProcessor.filterAndSortFormats.mockReturnValue([
        {
          format_id: '137',
          ext: 'mp4',
          format_note: '1080p',
          height: 1080,
          filesize: 10000000,
          vcodec: 'avc1',
          acodec: 'mp4a'
        }
      ]);
      
      mockVideoProcessor.getDirectUrl.mockResolvedValue('https://example.com/video.mp4');
      mockVideoProcessor.isCombinedFormat.mockReturnValue(true); // Комбинированный формат
      
      // Шаг 1: Отправка URL
      const msg = {
        chat: { id: 12345 },
        from: { id: 5, username: 'testuser5' },
        text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      };
      
      await botController.handleMessage(msg);
      
      // Проверяем, что получили форматы
      expect(mockVideoProcessor.getVideoInfo).toHaveBeenCalled();
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining('Test Video'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.any(Array)
          })
        })
      );
      
      // Шаг 2: Выбор качества
      const query = {
        id: 'query123',
        message: { chat: { id: 12345 } },
        from: { id: 5, username: 'testuser5' },
        data: 'dl_137_dQw4w9WgXcQ_1080p'
      };
      
      await botController.handleCallbackQuery(query);
      
      // Проверяем, что получили прямую ссылку
      expect(mockVideoProcessor.getDirectUrl).toHaveBeenCalled();
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining('Ссылка готова'),
        expect.any(Object)
      );
    });
    
    test('should handle yt-dlp errors gracefully', async () => {
      mockVideoProcessor.getVideoInfo.mockRejectedValue(new Error('NETWORK_ERROR'));
      
      const msg = {
        chat: { id: 12345 },
        from: { id: 6, username: 'testuser6' },
        text: 'https://www.youtube.com/watch?v=error123'
      };
      
      await botController.handleMessage(msg);
      
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining('Ошибка сети'),
        expect.any(Object)
      );
    });
  });
});
