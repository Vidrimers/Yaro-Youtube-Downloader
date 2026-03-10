const SponsorBlock = require('./sponsorblock');

// Мокаем axios для тестов retry механизма
jest.mock('axios');
const axios = require('axios');

// Мокаем Logger
jest.mock('./utils', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('SponsorBlock', () => {
  let sponsorBlock;

  beforeEach(() => {
    sponsorBlock = new SponsorBlock();
    jest.clearAllMocks();
  });

  describe('Retry механизм', () => {
    describe('isRetryableError', () => {
      test('должен определять повторяемые сетевые ошибки', () => {
        const retryableErrors = [
          new Error('Client network socket disconnected'),
          new Error('ECONNRESET'),
          new Error('ETIMEDOUT'),
          { code: 'ENOTFOUND' },
          { message: 'socket hang up' }
        ];

        retryableErrors.forEach(error => {
          expect(sponsorBlock.isRetryableError(error)).toBe(true);
        });
      });

      test('не должен повторять не-сетевые ошибки', () => {
        const nonRetryableErrors = [
          new Error('Bad Request'),
          new Error('Not Found'),
          { code: 'INVALID_REQUEST' }
        ];

        nonRetryableErrors.forEach(error => {
          expect(sponsorBlock.isRetryableError(error)).toBe(false);
        });
      });
    });

    describe('calculateDelay', () => {
      test('должен вычислять exponential backoff задержки', () => {
        expect(sponsorBlock.calculateDelay(0)).toBe(1000);  // baseDelay * 2^0
        expect(sponsorBlock.calculateDelay(1)).toBe(2000);  // baseDelay * 2^1
        expect(sponsorBlock.calculateDelay(2)).toBe(4000);  // baseDelay * 2^2
      });

      test('не должен превышать maxDelay', () => {
        sponsorBlock.maxDelay = 3000;
        expect(sponsorBlock.calculateDelay(5)).toBe(3000); // Should be capped at maxDelay
      });
    });

    describe('executeWithRetry', () => {
      test('должен успешно выполняться с первой попытки', async () => {
        const requestFn = jest.fn().mockResolvedValue('success');
        
        const result = await sponsorBlock.executeWithRetry(requestFn);
        
        expect(result).toBe('success');
        expect(requestFn).toHaveBeenCalledTimes(1);
      });

      test('должен повторять при повторяемых ошибках', async () => {
        const requestFn = jest.fn()
          .mockRejectedValueOnce(new Error('ECONNRESET'))
          .mockResolvedValue('success');
        
        const result = await sponsorBlock.executeWithRetry(requestFn);
        
        expect(result).toBe('success');
        expect(requestFn).toHaveBeenCalledTimes(2);
      });

      test('не должен повторять неповторяемые ошибки', async () => {
        const requestFn = jest.fn()
          .mockRejectedValue(new Error('Bad Request'));
        
        await expect(sponsorBlock.executeWithRetry(requestFn))
          .rejects.toThrow('Bad Request');
        
        expect(requestFn).toHaveBeenCalledTimes(1);
      });

      test('должен падать после максимального количества попыток', async () => {
        sponsorBlock.maxRetries = 2;
        const requestFn = jest.fn()
          .mockRejectedValue(new Error('ECONNRESET'));
        
        await expect(sponsorBlock.executeWithRetry(requestFn))
          .rejects.toThrow('ECONNRESET');
        
        expect(requestFn).toHaveBeenCalledTimes(3); // 1 + 2 retries
      });
    });

    describe('getSegments с retry', () => {
      test('должен повторять запрос при сетевых ошибках', async () => {
        axios.get
          .mockRejectedValueOnce(new Error('Client network socket disconnected'))
          .mockResolvedValue({
            data: [
              {
                category: "sponsor",
                actionType: "skip",
                segment: [10, 30],
                UUID: "test-uuid"
              }
            ],
            config: { url: '/api/skipSegments', params: {} }
          });

        const result = await sponsorBlock.getSegments('testVideoId');
        
        expect(result).toHaveLength(1);
        expect(result[0].category).toBe('sponsor');
        expect(axios.get).toHaveBeenCalledTimes(2);
      });

      test('должен возвращать пустой массив при 404 ошибке', async () => {
        const error404 = new Error('Not Found');
        error404.response = { status: 404 };
        axios.get.mockRejectedValue(error404);

        const result = await sponsorBlock.getSegments('testVideoId');
        
        expect(result).toEqual([]);
        expect(axios.get).toHaveBeenCalledTimes(1); // Не должен повторять 404
      });

      test('должен правильно парсить реальный ответ SponsorBlock API', async () => {
        const realApiResponse = [
          {
            "category": "intro",
            "actionType": "skip",
            "segment": [81.445, 93.539],
            "UUID": "3bab7479ac77d012e873c8e2b202124951799125a797091afa7996649a05992a7",
            "videoDuration": 904.721,
            "locked": 0,
            "votes": 0,
            "description": ""
          },
          {
            "category": "sponsor",
            "actionType": "skip",
            "segment": [353.862, 410.448],
            "UUID": "cb1520f94e223843b6ea5035dff506eeae3497a5f78972cf4f47eb0dfc784f257",
            "videoDuration": 904.721,
            "locked": 0,
            "votes": 2,
            "description": ""
          }
        ];

        axios.get.mockResolvedValue({
          data: realApiResponse,
          config: { url: '/api/skipSegments', params: {} }
        });

        const result = await sponsorBlock.getSegments('CwmBic30ffA');
        
        expect(result).toHaveLength(2);
        expect(result[0].category).toBe('intro');
        expect(result[0].segment).toEqual([81.445, 93.539]);
        expect(result[1].category).toBe('sponsor');
        expect(result[1].segment).toEqual([353.862, 410.448]);
      });
    });

    describe('Группы категорий', () => {
      test('getCategoryGroups должен возвращать правильные группы', () => {
        const groups = SponsorBlock.getCategoryGroups();
        
        expect(groups).toHaveProperty('ads');
        expect(groups.ads.categories).toEqual(['sponsor', 'selfpromo']);
        expect(groups).toHaveProperty('intro_outro');
        expect(groups.intro_outro.categories).toEqual(['intro', 'outro']);
        expect(groups).toHaveProperty('all');
        expect(groups.all.categories).toContain('sponsor');
      });

      test('filterSegmentsByCategories должен фильтровать сегменты по категориям', () => {
        const segments = [
          { category: 'sponsor', segment: [10, 20] },
          { category: 'intro', segment: [0, 5] },
          { category: 'outro', segment: [100, 110] },
          { category: 'interaction', segment: [50, 55] }
        ];

        const adsOnly = sponsorBlock.filterSegmentsByCategories(segments, ['sponsor', 'selfpromo']);
        expect(adsOnly).toHaveLength(1);
        expect(adsOnly[0].category).toBe('sponsor');

        const introOutro = sponsorBlock.filterSegmentsByCategories(segments, ['intro', 'outro']);
        expect(introOutro).toHaveLength(2);
        expect(introOutro.map(s => s.category)).toEqual(['intro', 'outro']);

        const empty = sponsorBlock.filterSegmentsByCategories(segments, []);
        expect(empty).toHaveLength(0);
      });
    });
  });

  describe('formatTime', () => {
    test('должен форматировать секунды в MM:SS', () => {
      expect(sponsorBlock.formatTime(65)).toBe('1:05');
      expect(sponsorBlock.formatTime(125)).toBe('2:05');
    });

    test('должен форматировать секунды в HH:MM:SS для длинных видео', () => {
      expect(sponsorBlock.formatTime(3665)).toBe('1:01:05');
      expect(sponsorBlock.formatTime(7325)).toBe('2:02:05');
    });

    test('должен обрабатывать 0 секунд', () => {
      expect(sponsorBlock.formatTime(0)).toBe('0:00');
    });
  });

  describe('formatSegmentsInfo', () => {
    test('должен возвращать null для пустого массива', () => {
      expect(sponsorBlock.formatSegmentsInfo([])).toBeNull();
      expect(sponsorBlock.formatSegmentsInfo(null)).toBeNull();
    });

    test('должен форматировать информацию о сегментах', () => {
      const segments = [
        {
          segment: [10, 30],
          category: 'sponsor'
        },
        {
          segment: [100, 120],
          category: 'selfpromo'
        }
      ];

      const result = sponsorBlock.formatSegmentsInfo(segments);
      
      expect(result).toHaveProperty('totalSegments', 2);
      expect(result).toHaveProperty('totalDuration', 40); // 20 + 20
      expect(result).toHaveProperty('totalDurationFormatted', '0:40');
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]).toHaveProperty('categoryName', '📢 Спонсорская реклама');
    });
  });

  describe('createSegmentsDescription', () => {
    test('должен создавать описание сегментов', () => {
      const info = {
        segments: [
          {
            categoryName: '📢 Спонсорская реклама',
            startFormatted: '0:10',
            endFormatted: '0:30',
            durationFormatted: '0:20'
          }
        ],
        totalSegments: 1,
        totalDurationFormatted: '0:20'
      };

      const description = sponsorBlock.createSegmentsDescription(info);
      
      expect(description).toContain('Найдены рекламные блоки');
      expect(description).toContain('📢 Спонсорская реклама');
      expect(description).toContain('0:10 - 0:30');
      expect(description).toContain('1 блоков, 0:20 рекламы');
    });
  });
});