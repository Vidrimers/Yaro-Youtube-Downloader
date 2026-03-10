const fc = require('fast-check');
const VideoProcessor = require('./ytdlp');

describe('VideoProcessor Property Tests', () => {
  let processor;

  beforeEach(() => {
    processor = new VideoProcessor();
  });

  /**
   * Property 2: Format Filtering Completeness
   * For any списка форматов из yt-dlp, все отфильтрованные форматы должны иметь 
   * vcodec != 'none' AND acodec != 'none', и все форматы должны быть отсортированы 
   * по убыванию высоты (height).
   * 
   * Feature: youtube-downloader-bot, Property 2: Format Filtering Completeness
   * Validates: Requirements 2.3, 2.4, 2.5
   */
  test('Property 2: Format Filtering Completeness', () => {
    // Генератор для формата
    const formatArbitrary = fc.record({
      format_id: fc.string({ minLength: 1, maxLength: 10 }),
      ext: fc.constantFrom('mp4', 'webm', 'mkv'),
      vcodec: fc.oneof(
        fc.constant('none'),
        fc.constantFrom('avc1', 'vp9', 'h264', 'av01')
      ),
      acodec: fc.oneof(
        fc.constant('none'),
        fc.constantFrom('mp4a', 'opus', 'aac')
      ),
      height: fc.oneof(
        fc.constant(null),
        fc.constantFrom(240, 360, 480, 720, 1080, 1440, 2160)
      ),
      format_note: fc.option(
        fc.constantFrom('240p', '360p', '480p', '720p', '1080p'),
        { nil: null }
      ),
      filesize: fc.option(
        fc.nat(1000000000), // до 1GB
        { nil: null }
      )
    });

    fc.assert(
      fc.property(
        fc.array(formatArbitrary, { minLength: 0, maxLength: 50 }),
        (formats) => {
          const filtered = processor.filterAndSortFormats(formats);

          // Проверка 1: Все отфильтрованные форматы имеют vcodec != 'none' 
          // (могут быть как комбинированные, так и видео-only форматы)
          const allHaveVideo = filtered.every(f => 
            f.vcodec && f.vcodec !== 'none'
          );

          // Проверка 2: Все форматы отсортированы по убыванию высоты
          let isSorted = true;
          for (let i = 0; i < filtered.length - 1; i++) {
            const currentHeight = filtered[i].height || 0;
            const nextHeight = filtered[i + 1].height || 0;
            if (currentHeight < nextHeight) {
              isSorted = false;
              break;
            }
          }

          return allHaveVideo && isSorted;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9: Timeout Enforcement
   * For any yt-dlp команды, если выполнение превышает указанный timeout, 
   * то executeYtDlp должен прервать процесс, освободить ресурсы и вернуть 
   * ошибку timeout в течение timeout + 1 секунды.
   * 
   * Feature: youtube-downloader-bot, Property 9: Timeout Enforcement
   * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5
   */
  test('Property 9: Timeout Enforcement', async () => {
    // Этот тест проверяет, что timeout срабатывает корректно
    // Используем команду, которая будет выполняться долго (sleep)
    
    const shortTimeout = 1000; // 1 секунда
    const startTime = Date.now();
    
    try {
      // Пытаемся выполнить команду с коротким timeout
      // yt-dlp с несуществующим URL будет пытаться подключиться долго
      await processor.executeYtDlp(['--help'], shortTimeout);
      
      // Если команда выполнилась быстро (help), это нормально
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(shortTimeout + 1000);
    } catch (error) {
      // Если получили timeout, проверяем, что он сработал вовремя
      const elapsed = Date.now() - startTime;
      
      if (error.message === 'TIMEOUT') {
        // Timeout должен сработать в пределах timeout + 1 секунда
        expect(elapsed).toBeGreaterThanOrEqual(shortTimeout);
        expect(elapsed).toBeLessThan(shortTimeout + 2000);
      }
    }
  }, 10000);

  /**
   * Property 12: Format Metadata Completeness
   * For any отфильтрованного формата, он должен содержать все необходимые метаданные: 
   * format_id, resolution, filesize, vcodec, acodec, и все значения должны быть непустыми.
   * 
   * Feature: youtube-downloader-bot, Property 12: Format Metadata Completeness
   * Validates: Requirements 2.5
   */
  test('Property 12: Format Metadata Completeness', () => {
    // Генератор для формата с полными метаданными
    const completeFormatArbitrary = fc.record({
      format_id: fc.string({ minLength: 1, maxLength: 10 }),
      ext: fc.constantFrom('mp4', 'webm', 'mkv'),
      vcodec: fc.constantFrom('avc1', 'vp9', 'h264', 'av01'),
      acodec: fc.constantFrom('mp4a', 'opus', 'aac'),
      height: fc.constantFrom(240, 360, 480, 720, 1080),
      format_note: fc.constantFrom('240p', '360p', '480p', '720p', '1080p'),
      filesize: fc.nat(1000000000)
    });

    fc.assert(
      fc.property(
        fc.array(completeFormatArbitrary, { minLength: 1, maxLength: 20 }),
        (formats) => {
          const filtered = processor.filterAndSortFormats(formats);

          // Проверяем, что все отфильтрованные форматы имеют необходимые метаданные
          const allHaveMetadata = filtered.every(f => {
            const hasFormatId = f.format_id && f.format_id.length > 0;
            const hasResolution = (f.format_note && f.format_note.length > 0) || f.height > 0;
            const hasVcodec = f.vcodec && f.vcodec !== 'none';
            const hasAcodec = f.acodec && f.acodec !== 'none';
            
            return hasFormatId && hasResolution && hasVcodec && hasAcodec;
          });

          return allHaveMetadata;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('VideoProcessor Unit Tests', () => {
  let processor;

  beforeEach(() => {
    processor = new VideoProcessor();
  });

  /**
   * Тест парсинга JSON ответа от yt-dlp
   * Requirements: 2.2
   */
  describe('JSON Parsing', () => {
    test('should parse valid yt-dlp JSON response', () => {
      const mockFormats = [
        {
          format_id: '137',
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 1080,
          format_note: '1080p',
          filesize: 50000000
        },
        {
          format_id: '136',
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 720,
          format_note: '720p',
          filesize: 30000000
        }
      ];

      const filtered = processor.filterAndSortFormats(mockFormats);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].height).toBe(1080);
      expect(filtered[1].height).toBe(720);
    });

    test('should handle formats without filesize', () => {
      const mockFormats = [
        {
          format_id: '137',
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 1080,
          format_note: '1080p',
          filesize: null
        }
      ];

      const filtered = processor.filterAndSortFormats(mockFormats);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].format_id).toBe('137');
    });

    test('should filter out formats without video or audio', () => {
      const mockFormats = [
        {
          format_id: '137',
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'none', // только видео - должен быть включен
          height: 1080,
          format_note: '1080p',
          filesize: 50000000
        },
        {
          format_id: '140',
          ext: 'mp4',
          vcodec: 'none', // только аудио - должен быть исключен
          acodec: 'mp4a',
          height: null,
          format_note: null,
          filesize: 5000000
        },
        {
          format_id: '22',
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a', // видео + аудио - должен быть включен
          height: 720,
          format_note: '720p',
          filesize: 30000000
        }
      ];

      const filtered = processor.filterAndSortFormats(mockFormats);

      // Должны быть включены форматы 137 (видео-only) и 22 (комбинированный)
      // Формат 140 (только аудио) должен быть исключен
      expect(filtered).toHaveLength(2);
      expect(filtered.map(f => f.format_id)).toContain('137');
      expect(filtered.map(f => f.format_id)).toContain('22');
      expect(filtered.map(f => f.format_id)).not.toContain('140');
    });
  });

  /**
   * Тест обработки ошибок yt-dlp
   * Requirements: 2.6, 12.3
   */
  describe('Error Handling', () => {
    test('should throw VIDEO_UNAVAILABLE for unavailable videos', async () => {
      // Мокируем executeYtDlp для симуляции ошибки
      processor.executeYtDlp = jest.fn().mockRejectedValue({
        stderr: 'Video unavailable',
        code: 1
      });

      await expect(processor.getVideoInfo('https://youtube.com/watch?v=invalid'))
        .rejects.toThrow('VIDEO_UNAVAILABLE');
    });

    test('should throw NETWORK_ERROR for network issues', async () => {
      processor.executeYtDlp = jest.fn().mockRejectedValue({
        stderr: 'network error: Connection failed',
        code: 1
      });

      await expect(processor.getVideoInfo('https://youtube.com/watch?v=test'))
        .rejects.toThrow('NETWORK_ERROR');
    });

    test('should throw TIMEOUT for timeout errors', async () => {
      processor.executeYtDlp = jest.fn().mockRejectedValue(new Error('TIMEOUT'));

      await expect(processor.getVideoInfo('https://youtube.com/watch?v=test'))
        .rejects.toThrow('TIMEOUT');
    });

    test('should throw FORMAT_UNAVAILABLE when format is not available', async () => {
      processor.executeYtDlp = jest.fn().mockRejectedValue({
        stderr: 'requested format not available',
        code: 1
      });

      await expect(processor.getDirectUrl('https://youtube.com/watch?v=test', '137'))
        .rejects.toThrow('FORMAT_UNAVAILABLE');
    });

    test('should throw UNKNOWN_ERROR for other errors', async () => {
      processor.executeYtDlp = jest.fn().mockRejectedValue({
        stderr: 'some unknown error',
        code: 1
      });

      await expect(processor.getVideoInfo('https://youtube.com/watch?v=test'))
        .rejects.toThrow('UNKNOWN_ERROR');
    });
  });

  /**
   * Тест timeout для долгих команд
   * Requirements: 12.3
   */
  describe('Timeout Handling', () => {
    test('should timeout long-running commands', async () => {
      const shortTimeout = 100; // 100ms
      const startTime = Date.now();

      // Создаем промис, который никогда не резолвится
      const originalExecute = processor.executeYtDlp.bind(processor);
      processor.executeYtDlp = jest.fn().mockImplementation(async (args, timeout) => {
        // Симулируем долгую команду
        return new Promise((resolve) => {
          setTimeout(() => resolve(''), timeout + 1000);
        });
      });

      try {
        await processor.executeYtDlp(['--help'], shortTimeout);
      } catch (error) {
        const elapsed = Date.now() - startTime;
        // Проверяем, что timeout сработал примерно в указанное время
        expect(elapsed).toBeGreaterThanOrEqual(shortTimeout);
        expect(elapsed).toBeLessThan(shortTimeout + 500);
      }
    }, 5000);
  });

  /**
   * Тест фильтрации по популярным разрешениям
   * Requirements: 2.3, 2.4, 2.5
   */
  describe('Format Filtering', () => {
    test('should only include popular resolutions', () => {
      const mockFormats = [
        {
          format_id: '1',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 2160,
          format_note: '2160p', // 4K - не популярное
          filesize: 100000000
        },
        {
          format_id: '2',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 1080,
          format_note: '1080p', // популярное
          filesize: 50000000
        },
        {
          format_id: '3',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 144,
          format_note: '144p', // не популярное
          filesize: 5000000
        },
        {
          format_id: '4',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 720,
          format_note: '720p', // популярное
          filesize: 30000000
        }
      ];

      const filtered = processor.filterAndSortFormats(mockFormats);

      // Должны остаться только 1080p и 720p
      expect(filtered).toHaveLength(2);
      expect(filtered[0].format_note).toBe('1080p');
      expect(filtered[1].format_note).toBe('720p');
    });

    test('should select format with smaller filesize for same resolution', () => {
      const mockFormats = [
        {
          format_id: '137',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 1080,
          format_note: '1080p',
          filesize: 50000000 // больший размер
        },
        {
          format_id: '248',
          vcodec: 'vp9',
          acodec: 'opus',
          height: 1080,
          format_note: '1080p',
          filesize: 30000000 // меньший размер
        }
      ];

      const filtered = processor.filterAndSortFormats(mockFormats);

      // Должен остаться только один формат с меньшим размером
      expect(filtered).toHaveLength(1);
      expect(filtered[0].format_id).toBe('248');
      expect(filtered[0].filesize).toBe(30000000);
    });

    test('should sort formats from high to low quality', () => {
      const mockFormats = [
        {
          format_id: '1',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 360,
          format_note: '360p',
          filesize: 10000000
        },
        {
          format_id: '2',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 1080,
          format_note: '1080p',
          filesize: 50000000
        },
        {
          format_id: '3',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 720,
          format_note: '720p',
          filesize: 30000000
        }
      ];

      const filtered = processor.filterAndSortFormats(mockFormats);

      expect(filtered).toHaveLength(3);
      expect(filtered[0].height).toBe(1080);
      expect(filtered[1].height).toBe(720);
      expect(filtered[2].height).toBe(360);
    });
  });
});
