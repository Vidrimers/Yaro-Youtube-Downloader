const fc = require('fast-check');
const TelegramHelper = require('./telegram');

// Mock TelegramBot
class MockTelegramBot {
  constructor() {
    this.sentMessages = [];
  }

  async sendMessage(chatId, text, options) {
    this.sentMessages.push({ chatId, text, options });
    return { message_id: Date.now() };
  }

  clearMessages() {
    this.sentMessages = [];
  }
}

describe('TelegramHelper Property Tests', () => {
  let mockBot;
  let helper;

  beforeEach(() => {
    mockBot = new MockTelegramBot();
    helper = new TelegramHelper(mockBot);
  });

  /**
   * Property 7: Inline Keyboard Structure Validity
   * For any списка форматов, созданная inline клавиатура должна содержать кнопки 
   * только для популярных разрешений (1080p, 720p, 480p, 360p, 240p), 
   * каждая кнопка должна содержать эмодзи 🎬, разрешение, формат и размер, 
   * и иметь валидный callback_data.
   * 
   * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
   * Feature: youtube-downloader-bot, Property 7: Inline Keyboard Structure Validity
   */
  test('Property 7: Inline Keyboard Structure Validity', () => {
    const POPULAR_RESOLUTIONS = ['1080p', '720p', '480p', '360p', '240p'];
    const VALID_EXTENSIONS = ['mp4', 'webm', 'mkv'];

    // Генератор форматов
    const formatArbitrary = fc.record({
      format_id: fc.string({ minLength: 1, maxLength: 10 }),
      format_note: fc.constantFrom(...POPULAR_RESOLUTIONS),
      height: fc.integer({ min: 240, max: 1080 }),
      filesize: fc.integer({ min: 1000000, max: 1000000000 }), // 1MB - 1GB
      ext: fc.constantFrom(...VALID_EXTENSIONS),
      vcodec: fc.constant('avc1'),
      acodec: fc.constant('mp4a')
    });

    const formatsArbitrary = fc.array(formatArbitrary, { minLength: 1, maxLength: 5 });
    const videoIdArbitrary = fc.string({ minLength: 11, maxLength: 11 });

    fc.assert(
      fc.property(
        formatsArbitrary,
        videoIdArbitrary,
        (formats, videoId) => {
          const keyboard = helper.createQualityKeyboard(formats, videoId);

          // Проверка 1: Структура клавиатуры валидна
          expect(keyboard).toHaveProperty('inline_keyboard');
          expect(Array.isArray(keyboard.inline_keyboard)).toBe(true);

          // Проверка 2: Каждая строка клавиатуры содержит массив кнопок
          keyboard.inline_keyboard.forEach(row => {
            expect(Array.isArray(row)).toBe(true);
            expect(row.length).toBeGreaterThan(0);

            row.forEach(button => {
              // Проверка 3: Каждая кнопка имеет text и callback_data
              expect(button).toHaveProperty('text');
              expect(button).toHaveProperty('callback_data');

              // Проверка 4: text содержит эмодзи 🎬
              expect(button.text).toContain('🎬');

              // Проверка 5: text содержит разрешение из популярных
              const hasPopularResolution = POPULAR_RESOLUTIONS.some(res => 
                button.text.includes(res)
              );
              expect(hasPopularResolution).toBe(true);

              // Проверка 6: text содержит формат файла (MP4, WEBM, MKV)
              const hasFormat = VALID_EXTENSIONS.some(ext => 
                button.text.toUpperCase().includes(ext.toUpperCase())
              );
              expect(hasFormat).toBe(true);

              // Проверка 7: text содержит размер файла (B, KB, MB, GB)
              const hasSizeUnit = /\((.*?)(B|KB|MB|GB)\)/.test(button.text);
              expect(hasSizeUnit).toBe(true);

              // Проверка 8: callback_data имеет правильный формат dl_*_*_*
              expect(button.callback_data).toMatch(/^dl_.+_.{11}_.+$/);

              // Проверка 9: callback_data содержит videoId
              expect(button.callback_data).toContain(videoId);
            });
          });

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Error Message Completeness
   * For any типа ошибки из ErrorTypes, sendError должен отправить непустое сообщение 
   * на русском языке с описанием ошибки, соответствующее типу ошибки.
   * 
   * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
   * Feature: youtube-downloader-bot, Property 8: Error Message Completeness
   */
  test('Property 8: Error Message Completeness', async () => {
    const ERROR_TYPES = [
      'invalid_url',
      'video_unavailable',
      'timeout',
      'network_error',
      'format_unavailable',
      'rate_limit_exceeded',
      'duration_exceeded',
      'unknown'
    ];

    const errorTypeArbitrary = fc.constantFrom(...ERROR_TYPES);
    const chatIdArbitrary = fc.integer({ min: 1, max: 999999999 });
    const detailsArbitrary = fc.string({ maxLength: 50 });

    await fc.assert(
      fc.asyncProperty(
        errorTypeArbitrary,
        chatIdArbitrary,
        detailsArbitrary,
        async (errorType, chatId, details) => {
          mockBot.clearMessages();
          
          await helper.sendError(chatId, errorType, details);

          // Проверка 1: Сообщение было отправлено
          expect(mockBot.sentMessages.length).toBe(1);

          const sentMessage = mockBot.sentMessages[0];

          // Проверка 2: Сообщение отправлено в правильный чат
          expect(sentMessage.chatId).toBe(chatId);

          // Проверка 3: Текст сообщения не пустой
          expect(sentMessage.text).toBeTruthy();
          expect(sentMessage.text.length).toBeGreaterThan(0);

          // Проверка 4: Сообщение содержит эмодзи ошибки (❌, ⏱, 🌐, ⏳)
          const hasErrorEmoji = /[❌⏱🌐⏳]/.test(sentMessage.text);
          expect(hasErrorEmoji).toBe(true);

          // Проверка 5: Сообщение содержит кириллицу (русский язык)
          const hasCyrillic = /[а-яА-ЯёЁ]/.test(sentMessage.text);
          expect(hasCyrillic).toBe(true);

          // Проверка 6: Используется Markdown
          expect(sentMessage.options).toHaveProperty('parse_mode');
          expect(sentMessage.options.parse_mode).toBe('Markdown');

          // Проверка 7: Сообщение содержит жирный текст (Markdown *)
          expect(sentMessage.text).toContain('*');

          // Проверка 8: Для rate_limit_exceeded детали включены в сообщение
          if (errorType === 'rate_limit_exceeded' && details) {
            expect(sentMessage.text).toContain(details);
          }

          // Проверка 9: Для duration_exceeded детали включены в сообщение
          if (errorType === 'duration_exceeded' && details) {
            expect(sentMessage.text).toContain(details);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('TelegramHelper Unit Tests', () => {
  let mockBot;
  let helper;

  beforeEach(() => {
    mockBot = new MockTelegramBot();
    helper = new TelegramHelper(mockBot);
  });

  describe('createQualityKeyboard', () => {
    test('должен создать клавиатуру с правильным форматом кнопок', () => {
      const formats = [
        {
          format_id: '137',
          format_note: '1080p',
          height: 1080,
          filesize: 157286400, // ~150 MB
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a'
        },
        {
          format_id: '136',
          format_note: '720p',
          height: 720,
          filesize: 104857600, // ~100 MB
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a'
        }
      ];

      const videoId = 'dQw4w9WgXcQ';
      const keyboard = helper.createQualityKeyboard(formats, videoId);

      expect(keyboard.inline_keyboard).toHaveLength(2);
      
      // Проверка первой кнопки (1080p)
      const button1080p = keyboard.inline_keyboard[0][0];
      expect(button1080p.text).toContain('🎬');
      expect(button1080p.text).toContain('1080p');
      expect(button1080p.text).toContain('MP4');
      expect(button1080p.text).toContain('150 MB');
      expect(button1080p.callback_data).toBe('dl_137_dQw4w9WgXcQ_1080p');

      // Проверка второй кнопки (720p)
      const button720p = keyboard.inline_keyboard[1][0];
      expect(button720p.text).toContain('🎬');
      expect(button720p.text).toContain('720p');
      expect(button720p.text).toContain('MP4');
      expect(button720p.text).toContain('100 MB');
      expect(button720p.callback_data).toBe('dl_136_dQw4w9WgXcQ_720p');
    });

    test('должен обрабатывать форматы без format_note', () => {
      const formats = [
        {
          format_id: '135',
          height: 480,
          filesize: 52428800, // ~50 MB
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a'
        }
      ];

      const videoId = 'test12345ab';
      const keyboard = helper.createQualityKeyboard(formats, videoId);

      const button = keyboard.inline_keyboard[0][0];
      expect(button.text).toContain('480p');
      expect(button.callback_data).toBe('dl_135_test12345ab_480p');
    });

    test('должен обрабатывать форматы с нулевым размером', () => {
      const formats = [
        {
          format_id: '134',
          format_note: '360p',
          height: 360,
          filesize: 0,
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a'
        }
      ];

      const videoId = 'test12345ab';
      const keyboard = helper.createQualityKeyboard(formats, videoId);

      const button = keyboard.inline_keyboard[0][0];
      expect(button.text).toContain('0 B');
    });
  });

  describe('sendError', () => {
    test('должен отправить сообщение для invalid_url', async () => {
      await helper.sendError(12345, 'invalid_url');

      expect(mockBot.sentMessages).toHaveLength(1);
      const message = mockBot.sentMessages[0];
      expect(message.text).toContain('Неверная ссылка');
      expect(message.text).toContain('youtube.com');
    });

    test('должен отправить сообщение для video_unavailable', async () => {
      await helper.sendError(12345, 'video_unavailable');

      const message = mockBot.sentMessages[0];
      expect(message.text).toContain('Видео недоступно');
      expect(message.text).toContain('Удалено');
    });

    test('должен отправить сообщение для timeout', async () => {
      await helper.sendError(12345, 'timeout');

      const message = mockBot.sentMessages[0];
      expect(message.text).toContain('Превышено время ожидания');
    });

    test('должен отправить сообщение для network_error', async () => {
      await helper.sendError(12345, 'network_error');

      const message = mockBot.sentMessages[0];
      expect(message.text).toContain('Ошибка сети');
    });

    test('должен отправить сообщение для format_unavailable', async () => {
      await helper.sendError(12345, 'format_unavailable');

      const message = mockBot.sentMessages[0];
      expect(message.text).toContain('Формат недоступен');
    });

    test('должен отправить сообщение для rate_limit_exceeded с деталями', async () => {
      await helper.sendError(12345, 'rate_limit_exceeded', '45');

      const message = mockBot.sentMessages[0];
      expect(message.text).toContain('Слишком много запросов');
      expect(message.text).toContain('45');
    });

    test('должен отправить сообщение для duration_exceeded с деталями', async () => {
      await helper.sendError(12345, 'duration_exceeded', '60');

      const message = mockBot.sentMessages[0];
      expect(message.text).toContain('Видео слишком длинное');
      expect(message.text).toContain('60');
    });

    test('должен отправить сообщение для unknown', async () => {
      await helper.sendError(12345, 'unknown');

      const message = mockBot.sentMessages[0];
      expect(message.text).toContain('Произошла ошибка');
    });

    test('должен отправить сообщение для неизвестного типа ошибки', async () => {
      await helper.sendError(12345, 'some_random_error');

      const message = mockBot.sentMessages[0];
      expect(message.text).toContain('Произошла ошибка');
    });
  });

  describe('sendWelcome', () => {
    test('должен отправить приветственное сообщение', async () => {
      await helper.sendWelcome(12345);

      expect(mockBot.sentMessages).toHaveLength(1);
      const message = mockBot.sentMessages[0];
      expect(message.chatId).toBe(12345);
      expect(message.text).toContain('Добро пожаловать');
      expect(message.text).toContain('YouTube');
      expect(message.text).toContain('/help');
      expect(message.options.parse_mode).toBe('Markdown');
    });
  });

  describe('sendHelp', () => {
    test('должен отправить справку', async () => {
      await helper.sendHelp(12345);

      expect(mockBot.sentMessages).toHaveLength(1);
      const message = mockBot.sentMessages[0];
      expect(message.chatId).toBe(12345);
      expect(message.text).toContain('Справка');
      expect(message.text).toContain('youtube.com');
      expect(message.text).toContain('1080p');
      expect(message.text).toContain('/start');
      expect(message.text).toContain('/help');
      expect(message.options.parse_mode).toBe('Markdown');
    });
  });

  describe('sendVideoOptions', () => {
    test('должен отправить сообщение с вариантами качества', async () => {
      const videoInfo = {
        id: 'dQw4w9WgXcQ',
        title: 'Test Video',
        duration: 213,
        uploader: 'Test Channel',
        formats: [
          {
            format_id: '137',
            format_note: '1080p',
            height: 1080,
            filesize: 157286400,
            ext: 'mp4',
            vcodec: 'avc1',
            acodec: 'mp4a'
          }
        ]
      };

      await helper.sendVideoOptions(12345, videoInfo);

      expect(mockBot.sentMessages).toHaveLength(1);
      const message = mockBot.sentMessages[0];
      expect(message.chatId).toBe(12345);
      expect(message.text).toContain('Test Video');
      expect(message.text).toContain('3:33'); // 213 секунд = 3:33
      expect(message.text).toContain('Test Channel');
      expect(message.text).toContain('Выберите качество');
      expect(message.options.parse_mode).toBe('Markdown');
      expect(message.options.reply_markup).toBeDefined();
    });
  });

  describe('sendDirectLink', () => {
    test('должен отправить прямую ссылку', async () => {
      const url = 'https://example.com/video.mp4';
      const quality = '1080p';

      await helper.sendDirectLink(12345, url, quality);

      expect(mockBot.sentMessages).toHaveLength(1);
      const message = mockBot.sentMessages[0];
      expect(message.chatId).toBe(12345);
      expect(message.text).toContain('Ссылка готова');
      expect(message.text).toContain('1080p');
      expect(message.text).toContain(url);
      expect(message.options.parse_mode).toBe('Markdown');
      expect(message.options.disable_web_page_preview).toBe(true);
    });
  });
});
