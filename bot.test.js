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
      filterAndSortFormats: jest.fn()
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

    describe('handleCallbackQuery', () => {
      test('should handle valid callback query', async () => {
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
        mockVideoProcessor.getDirectUrl.mockRejectedValue(new Error('FORMAT_UNAVAILABLE'));
        
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
