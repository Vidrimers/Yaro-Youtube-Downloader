const fc = require('fast-check');
const { URLValidator, Formatter, RateLimiter, Logger } = require('./utils');

describe('URLValidator Property Tests', () => {
  /**
   * Feature: youtube-downloader-bot, Property 1: URL Validation Consistency
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
   * 
   * For any строку, если она содержит домен youtube.com или youtu.be и соответствует 
   * одному из поддерживаемых форматов URL, то isYouTubeUrl должен вернуть true, 
   * и extractVideoId должен вернуть непустой video ID длиной 11 символов.
   */
  test('Property 1: URL Validation Consistency', () => {
    // Генератор валидных video ID (11 символов, буквы и цифры)
    const videoIdArbitrary = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')
      ),
      { minLength: 11, maxLength: 11 }
    );

    // Генератор различных форматов YouTube URL
    const youtubeUrlArbitrary = videoIdArbitrary.chain(videoId => 
      fc.constantFrom(
        `https://www.youtube.com/watch?v=${videoId}`,
        `https://youtube.com/watch?v=${videoId}`,
        `https://m.youtube.com/watch?v=${videoId}`,
        `https://youtu.be/${videoId}`,
        `http://www.youtube.com/watch?v=${videoId}`,
        `http://youtu.be/${videoId}`
      ).map(url => ({ url, videoId }))
    );

    fc.assert(
      fc.property(youtubeUrlArbitrary, ({ url, videoId }) => {
        // isYouTubeUrl должен вернуть true для валидных URL
        const isValid = URLValidator.isYouTubeUrl(url);
        expect(isValid).toBe(true);

        // extractVideoId должен вернуть правильный video ID
        const extractedId = URLValidator.extractVideoId(url);
        expect(extractedId).toBe(videoId);
        expect(extractedId).toHaveLength(11);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  test('Property 1: URL Validation Consistency - Invalid URLs', () => {
    // Генератор невалидных URL
    const invalidUrlArbitrary = fc.oneof(
      fc.webUrl({ validSchemes: ['http', 'https'] }).filter(url => 
        !url.includes('youtube.com') && !url.includes('youtu.be')
      ),
      fc.string().filter(s => s.length > 0 && !s.includes('youtube')),
      fc.constant('not a url'),
      fc.constant(''),
      fc.constant('https://vimeo.com/123456')
    );

    fc.assert(
      fc.property(invalidUrlArbitrary, (url) => {
        // isYouTubeUrl должен вернуть false для невалидных URL
        const isValid = URLValidator.isYouTubeUrl(url);
        expect(isValid).toBe(false);

        // extractVideoId должен вернуть null для невалидных URL
        const extractedId = URLValidator.extractVideoId(url);
        expect(extractedId).toBeNull();

        return true;
      }),
      { numRuns: 100 }
    );
  });

  test('Property 1: URL Validation Consistency - Normalization Round Trip', () => {
    const videoIdArbitrary = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')
      ),
      { minLength: 11, maxLength: 11 }
    );

    const youtubeUrlArbitrary = videoIdArbitrary.chain(videoId => 
      fc.constantFrom(
        `https://www.youtube.com/watch?v=${videoId}`,
        `https://youtu.be/${videoId}`
      ).map(url => ({ url, videoId }))
    );

    fc.assert(
      fc.property(youtubeUrlArbitrary, ({ url, videoId }) => {
        // Нормализация должна сохранить video ID
        const normalized = URLValidator.normalizeUrl(url);
        expect(normalized).toBe(`https://www.youtube.com/watch?v=${videoId}`);

        // Нормализованный URL должен быть валидным
        expect(URLValidator.isYouTubeUrl(normalized)).toBe(true);
        expect(URLValidator.extractVideoId(normalized)).toBe(videoId);

        return true;
      }),
      { numRuns: 100 }
    );
  });
});

describe('URLValidator Unit Tests', () => {
  describe('isYouTubeUrl', () => {
    test('should validate standard YouTube URL', () => {
      expect(URLValidator.isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    test('should validate short YouTube URL', () => {
      expect(URLValidator.isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    test('should validate mobile YouTube URL', () => {
      expect(URLValidator.isYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    test('should reject non-YouTube URL', () => {
      expect(URLValidator.isYouTubeUrl('https://vimeo.com/123456')).toBe(false);
    });

    test('should reject invalid input', () => {
      expect(URLValidator.isYouTubeUrl('')).toBe(false);
      expect(URLValidator.isYouTubeUrl(null)).toBe(false);
      expect(URLValidator.isYouTubeUrl(undefined)).toBe(false);
      expect(URLValidator.isYouTubeUrl(123)).toBe(false);
    });

    test('should reject YouTube URL without video ID', () => {
      expect(URLValidator.isYouTubeUrl('https://www.youtube.com/watch')).toBe(false);
      expect(URLValidator.isYouTubeUrl('https://www.youtube.com/')).toBe(false);
    });
  });

  describe('extractVideoId', () => {
    test('should extract video ID from standard URL', () => {
      expect(URLValidator.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    test('should extract video ID from short URL', () => {
      expect(URLValidator.extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    test('should return null for invalid URL', () => {
      expect(URLValidator.extractVideoId('https://vimeo.com/123456')).toBeNull();
      expect(URLValidator.extractVideoId('not a url')).toBeNull();
    });

    test('should handle URL with additional parameters', () => {
      expect(URLValidator.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ');
      expect(URLValidator.extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=10s')).toBe('dQw4w9WgXcQ');
    });
  });

  describe('normalizeUrl', () => {
    test('should normalize short URL to standard format', () => {
      expect(URLValidator.normalizeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    test('should keep standard URL unchanged', () => {
      expect(URLValidator.normalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    test('should return original URL if invalid', () => {
      const invalidUrl = 'https://vimeo.com/123456';
      expect(URLValidator.normalizeUrl(invalidUrl)).toBe(invalidUrl);
    });
  });
});


describe('Formatter Property Tests', () => {
  /**
   * Feature: youtube-downloader-bot, Property 3: Callback Data Round Trip
   * Validates: Requirements 3.3, 4.2
   * 
   * For any валидных значений formatId, videoId и quality, создание callback_data 
   * через createCallbackData и последующий парсинг через parseCallbackData 
   * должны вернуть эквивалентные значения.
   */
  test('Property 3: Callback Data Round Trip', () => {
    // Генератор для formatId без подчеркиваний
    const formatIdArbitrary = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'.split('')),
      { minLength: 1, maxLength: 20 }
    );
    // Генератор для videoId - YouTube video ID (11 символов, может содержать подчеркивания)
    const videoIdArbitrary = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')),
      { minLength: 11, maxLength: 11 }
    );
    // Генератор для quality без подчеркиваний
    const qualityArbitrary = fc.constantFrom('1080p', '720p', '480p', '360p', '240p');

    fc.assert(
      fc.property(
        formatIdArbitrary,
        videoIdArbitrary,
        qualityArbitrary,
        (formatId, videoId, quality) => {
          const callbackData = Formatter.createCallbackData(formatId, videoId, quality);
          const parsed = Formatter.parseCallbackData(callbackData);

          expect(parsed).not.toBeNull();
          expect(parsed.formatId).toBe(formatId);
          expect(parsed.videoId).toBe(videoId);
          expect(parsed.quality).toBe(quality);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: youtube-downloader-bot, Property 5: File Size Formatting Correctness
   * Validates: Requirements 11.1, 11.3, 11.4, 11.5
   * 
   * For any неотрицательного числа байт, formatFileSize должен вернуть строку 
   * с правильной единицей измерения (B, KB, MB, GB) в зависимости от размера.
   */
  test('Property 5: File Size Formatting Correctness', () => {
    fc.assert(
      fc.property(
        fc.nat(10000000000), // до 10GB
        (bytes) => {
          const formatted = Formatter.formatFileSize(bytes);

          // Проверяем формат строки
          expect(formatted).toMatch(/^\d+\s+(B|KB|MB|GB)$/);

          // Проверяем правильность единицы измерения
          if (bytes < 1024) {
            expect(formatted).toContain('B');
            expect(formatted).toBe(`${bytes} B`);
          } else if (bytes < 1048576) {
            expect(formatted).toContain('KB');
            const kb = Math.round(bytes / 1024);
            expect(formatted).toBe(`${kb} KB`);
          } else if (bytes < 1073741824) {
            expect(formatted).toContain('MB');
            const mb = Math.round(bytes / 1048576);
            expect(formatted).toBe(`${mb} MB`);
          } else {
            expect(formatted).toContain('GB');
            const gb = Math.round(bytes / 1073741824);
            expect(formatted).toBe(`${gb} GB`);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: youtube-downloader-bot, Property 6: Duration Formatting Correctness
   * Validates: Requirements 11.2, 11.6, 11.7
   * 
   * For any неотрицательного числа секунд, formatDuration должен вернуть строку 
   * в формате SS, MM:SS или HH:MM:SS в зависимости от длительности.
   */
  test('Property 6: Duration Formatting Correctness', () => {
    fc.assert(
      fc.property(
        fc.nat(86400), // до 24 часов
        (seconds) => {
          const formatted = Formatter.formatDuration(seconds);

          // Проверяем формат строки
          if (seconds < 60) {
            expect(formatted).toMatch(/^0:\d{2}$/);
          } else if (seconds < 3600) {
            expect(formatted).toMatch(/^\d{1,2}:\d{2}$/);
            const minutes = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            expect(formatted).toBe(`${minutes}:${secs.toString().padStart(2, '0')}`);
          } else {
            expect(formatted).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            expect(formatted).toBe(`${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Formatter Unit Tests', () => {
  describe('formatFileSize', () => {
    test('should format bytes', () => {
      expect(Formatter.formatFileSize(0)).toBe('0 B');
      expect(Formatter.formatFileSize(500)).toBe('500 B');
      expect(Formatter.formatFileSize(1023)).toBe('1023 B');
    });

    test('should format kilobytes', () => {
      expect(Formatter.formatFileSize(1024)).toBe('1 KB');
      expect(Formatter.formatFileSize(2048)).toBe('2 KB');
      expect(Formatter.formatFileSize(1048575)).toBe('1024 KB');
    });

    test('should format megabytes', () => {
      expect(Formatter.formatFileSize(1048576)).toBe('1 MB');
      expect(Formatter.formatFileSize(10485760)).toBe('10 MB');
      expect(Formatter.formatFileSize(1073741823)).toBe('1024 MB');
    });

    test('should format gigabytes', () => {
      expect(Formatter.formatFileSize(1073741824)).toBe('1 GB');
      expect(Formatter.formatFileSize(5368709120)).toBe('5 GB');
    });

    test('should handle invalid input', () => {
      expect(Formatter.formatFileSize(-1)).toBe('0 B');
      expect(Formatter.formatFileSize(null)).toBe('0 B');
      expect(Formatter.formatFileSize(undefined)).toBe('0 B');
    });
  });

  describe('formatDuration', () => {
    test('should format seconds only', () => {
      expect(Formatter.formatDuration(0)).toBe('0:00');
      expect(Formatter.formatDuration(30)).toBe('0:30');
      expect(Formatter.formatDuration(59)).toBe('0:59');
    });

    test('should format minutes and seconds', () => {
      expect(Formatter.formatDuration(60)).toBe('1:00');
      expect(Formatter.formatDuration(90)).toBe('1:30');
      expect(Formatter.formatDuration(3599)).toBe('59:59');
    });

    test('should format hours, minutes and seconds', () => {
      expect(Formatter.formatDuration(3600)).toBe('1:00:00');
      expect(Formatter.formatDuration(3661)).toBe('1:01:01');
      expect(Formatter.formatDuration(7200)).toBe('2:00:00');
    });

    test('should handle invalid input', () => {
      expect(Formatter.formatDuration(-1)).toBe('0:00');
      expect(Formatter.formatDuration(null)).toBe('0:00');
      expect(Formatter.formatDuration(undefined)).toBe('0:00');
    });
  });

  describe('createCallbackData', () => {
    test('should create callback data', () => {
      expect(Formatter.createCallbackData('137', 'dQw4w9WgXcQ', '1080p')).toBe('dl_137_dQw4w9WgXcQ_1080p');
      expect(Formatter.createCallbackData('136', 'abc123def45', '720p')).toBe('dl_136_abc123def45_720p');
    });
  });

  describe('parseCallbackData', () => {
    test('should parse callback data', () => {
      const result = Formatter.parseCallbackData('dl_137_dQw4w9WgXcQ_1080p');
      expect(result).toEqual({
        formatId: '137',
        videoId: 'dQw4w9WgXcQ',
        quality: '1080p'
      });
    });

    test('should return null for invalid data', () => {
      expect(Formatter.parseCallbackData('invalid')).toBeNull();
      expect(Formatter.parseCallbackData('dl_only_two')).toBeNull();
      expect(Formatter.parseCallbackData('')).toBeNull();
      expect(Formatter.parseCallbackData(null)).toBeNull();
    });

    test('should handle callback data with underscores in parts', () => {
      const result = Formatter.parseCallbackData('dl_137_dQw4w9WgXcQ_1080p');
      expect(result.formatId).toBe('137');
      expect(result.videoId).toBe('dQw4w9WgXcQ');
      expect(result.quality).toBe('1080p');
    });
  });
});


describe('RateLimiter Property Tests', () => {
  /**
   * Feature: youtube-downloader-bot, Property 4: Rate Limiter Enforcement
   * Validates: Requirements 6.2, 6.3, 6.4
   * 
   * For any пользователя, если он делает больше MAX_REQUESTS запросов в течение 
   * WINDOW_MS миллисекунд, то canMakeRequest должен вернуть false для всех 
   * последующих запросов.
   */
  test('Property 4: Rate Limiter Enforcement', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }), // maxRequests
        fc.integer({ min: 100, max: 1000 }), // windowMs
        fc.integer({ min: 1, max: 1000000 }), // userId
        (maxRequests, windowMs, userId) => {
          const limiter = new RateLimiter(maxRequests, windowMs);

          // Делаем maxRequests запросов
          for (let i = 0; i < maxRequests; i++) {
            expect(limiter.canMakeRequest(userId)).toBe(true);
            limiter.recordRequest(userId);
          }

          // Следующий запрос должен быть заблокирован
          expect(limiter.canMakeRequest(userId)).toBe(false);

          // Все последующие запросы в пределах окна должны быть заблокированы
          for (let i = 0; i < 5; i++) {
            expect(limiter.canMakeRequest(userId)).toBe(false);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: youtube-downloader-bot, Property 11: Rate Limiter Cleanup
   * Validates: Requirements 6.5
   * 
   * For any пользователя, после истечения временного окна (WINDOW_MS), 
   * счетчик запросов должен быть очищен, и пользователь должен снова 
   * иметь возможность делать запросы.
   */
  test('Property 11: Rate Limiter Cleanup', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }), // maxRequests
        fc.integer({ min: 1, max: 1000000 }), // userId
        async (maxRequests, userId) => {
          const windowMs = 100; // Короткое окно для быстрого теста
          const limiter = new RateLimiter(maxRequests, windowMs);

          // Заполняем лимит
          for (let i = 0; i < maxRequests; i++) {
            limiter.recordRequest(userId);
          }

          // Проверяем, что лимит достигнут
          expect(limiter.canMakeRequest(userId)).toBe(false);

          // Ждем истечения окна
          await new Promise((resolve) => setTimeout(resolve, windowMs + 50));

          // После истечения окна должна быть возможность делать запросы
          expect(limiter.canMakeRequest(userId)).toBe(true);
        }
      ),
      { numRuns: 20 } // Меньше итераций из-за setTimeout
    );
  });
});

describe('RateLimiter Unit Tests', () => {
  describe('canMakeRequest', () => {
    test('should allow requests within limit', () => {
      const limiter = new RateLimiter(5, 60000);
      const userId = 123;

      for (let i = 0; i < 5; i++) {
        expect(limiter.canMakeRequest(userId)).toBe(true);
        limiter.recordRequest(userId);
      }
    });

    test('should block requests exceeding limit', () => {
      const limiter = new RateLimiter(3, 60000);
      const userId = 123;

      // Делаем 3 запроса
      for (let i = 0; i < 3; i++) {
        limiter.recordRequest(userId);
      }

      // 4-й запрос должен быть заблокирован
      expect(limiter.canMakeRequest(userId)).toBe(false);
    });

    test('should track different users separately', () => {
      const limiter = new RateLimiter(2, 60000);

      limiter.recordRequest(1);
      limiter.recordRequest(1);
      limiter.recordRequest(2);

      expect(limiter.canMakeRequest(1)).toBe(false);
      expect(limiter.canMakeRequest(2)).toBe(true);
    });
  });

  describe('recordRequest', () => {
    test('should record request timestamp', () => {
      const limiter = new RateLimiter(5, 60000);
      const userId = 123;

      limiter.recordRequest(userId);
      expect(limiter.requests.get(userId)).toHaveLength(1);

      limiter.recordRequest(userId);
      expect(limiter.requests.get(userId)).toHaveLength(2);
    });
  });

  describe('getTimeUntilReset', () => {
    test('should return 0 for user with no requests', () => {
      const limiter = new RateLimiter(5, 60000);
      expect(limiter.getTimeUntilReset(123)).toBe(0);
    });

    test('should return time until oldest request expires', () => {
      const limiter = new RateLimiter(5, 1000);
      const userId = 123;

      limiter.recordRequest(userId);
      const timeUntilReset = limiter.getTimeUntilReset(userId);

      expect(timeUntilReset).toBeGreaterThan(0);
      expect(timeUntilReset).toBeLessThanOrEqual(1000);
    });
  });

  describe('cleanup', () => {
    test('should remove expired requests', async () => {
      const limiter = new RateLimiter(5, 100);
      const userId = 123;

      limiter.recordRequest(userId);
      expect(limiter.requests.has(userId)).toBe(true);

      // Ждем истечения окна
      await new Promise(resolve => setTimeout(resolve, 150));

      limiter.cleanup();
      expect(limiter.requests.has(userId)).toBe(false);
    });

    test('should keep recent requests', () => {
      const limiter = new RateLimiter(5, 60000);
      const userId = 123;

      limiter.recordRequest(userId);
      limiter.cleanup();

      expect(limiter.requests.has(userId)).toBe(true);
    });
  });
});


describe('Logger Property Tests', () => {
  /**
   * Feature: youtube-downloader-bot, Property 10: Log Format Consistency
   * Validates: Requirements 7.5
   * 
   * For any лог сообщения, оно должно содержать timestamp в формате 
   * [YYYY-MM-DD HH:MM:SS], уровень логирования (INFO, ERROR) и текст сообщения.
   */
  test('Property 10: Log Format Consistency', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('INFO', 'ERROR', 'USER'),
        fc.string({ minLength: 1, maxLength: 100 }),
        (level, message) => {
          const formatted = Logger.format(level, message);

          // Проверяем формат: [YYYY-MM-DD HH:MM:SS] LEVEL: Message
          const regex = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] (INFO|ERROR|USER): .+$/;
          expect(formatted).toMatch(regex);

          // Проверяем, что уровень присутствует
          expect(formatted).toContain(level);

          // Проверяем, что сообщение присутствует
          expect(formatted).toContain(message);

          // Проверяем структуру timestamp
          const timestampMatch = formatted.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
          expect(timestampMatch).not.toBeNull();

          const timestamp = timestampMatch[1];
          const [datePart, timePart] = timestamp.split(' ');
          const [year, month, day] = datePart.split('-').map(Number);
          const [hours, minutes, seconds] = timePart.split(':').map(Number);

          // Проверяем валидность даты и времени
          expect(year).toBeGreaterThanOrEqual(2020);
          expect(year).toBeLessThanOrEqual(2100);
          expect(month).toBeGreaterThanOrEqual(1);
          expect(month).toBeLessThanOrEqual(12);
          expect(day).toBeGreaterThanOrEqual(1);
          expect(day).toBeLessThanOrEqual(31);
          expect(hours).toBeGreaterThanOrEqual(0);
          expect(hours).toBeLessThanOrEqual(23);
          expect(minutes).toBeGreaterThanOrEqual(0);
          expect(minutes).toBeLessThanOrEqual(59);
          expect(seconds).toBeGreaterThanOrEqual(0);
          expect(seconds).toBeLessThanOrEqual(59);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Logger Unit Tests', () => {
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('info', () => {
    test('should log info message', () => {
      Logger.info('Test message');
      expect(consoleLogSpy).toHaveBeenCalled();
      const loggedMessage = consoleLogSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('INFO');
      expect(loggedMessage).toContain('Test message');
    });

    test('should log info message with metadata', () => {
      Logger.info('Test message', { key: 'value' });
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleLogSpy.mock.calls[0][1]).toEqual({ key: 'value' });
    });
  });

  describe('error', () => {
    test('should log error message', () => {
      const error = new Error('Test error');
      Logger.error('Error occurred', error);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedMessage = consoleErrorSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('ERROR');
      expect(loggedMessage).toContain('Error occurred');
    });

    test('should log error with stack trace', () => {
      const error = new Error('Test error');
      Logger.error('Error occurred', error);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][1]).toContain('Error: Test error');
    });
  });

  describe('userAction', () => {
    test('should log user action', () => {
      Logger.userAction(123, 'testuser', 'sent URL');
      expect(consoleLogSpy).toHaveBeenCalled();
      const loggedMessage = consoleLogSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('USER');
      expect(loggedMessage).toContain('User 123');
      expect(loggedMessage).toContain('@testuser');
      expect(loggedMessage).toContain('sent URL');
    });

    test('should log user action with details', () => {
      Logger.userAction(123, 'testuser', 'sent URL', { url: 'https://youtube.com/watch?v=test' });
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleLogSpy.mock.calls[0][1]).toEqual({ url: 'https://youtube.com/watch?v=test' });
    });
  });

  describe('format', () => {
    test('should format log message correctly', () => {
      const formatted = Logger.format('INFO', 'Test message');
      expect(formatted).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] INFO: Test message$/);
    });

    test('should include current timestamp', () => {
      const before = new Date();
      const formatted = Logger.format('INFO', 'Test');
      const after = new Date();

      const timestampMatch = formatted.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
      expect(timestampMatch).not.toBeNull();

      const timestamp = new Date(timestampMatch[1].replace(' ', 'T'));
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });
  });
});
