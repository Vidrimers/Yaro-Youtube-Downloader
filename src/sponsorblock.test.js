const SponsorBlock = require('./sponsorblock');

describe('SponsorBlock', () => {
  let sponsorBlock;

  beforeEach(() => {
    sponsorBlock = new SponsorBlock();
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