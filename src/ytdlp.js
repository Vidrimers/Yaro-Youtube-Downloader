const { spawn } = require('child_process');
const config = require('../config/config');

/**
 * VideoProcessor - класс для взаимодействия с yt-dlp
 * Получает информацию о видео и прямые ссылки на скачивание
 */
class VideoProcessor {
  /**
   * Выполняет команду yt-dlp с заданным timeout
   * @private
   * @param {string[]} args - аргументы для yt-dlp
   * @param {number} timeout - timeout в миллисекундах
   * @returns {Promise<string>} - stdout от yt-dlp
   * @throws {Error} - если команда завершилась с ошибкой или timeout
   */
  async executeYtDlp(args, timeout) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      
      // Запускаем yt-dlp процесс
      const process = spawn('yt-dlp', args);
      
      // Устанавливаем timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        process.kill('SIGTERM');
        
        // Если процесс не завершился через 1 секунду, убиваем принудительно
        setTimeout(() => {
          if (!process.killed) {
            process.kill('SIGKILL');
          }
        }, 1000);
        
        reject(new Error('TIMEOUT'));
      }, timeout);
      
      // Собираем stdout
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      // Собираем stderr
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      // Обрабатываем завершение процесса
      process.on('close', (code) => {
        clearTimeout(timeoutId);
        
        if (timedOut) {
          return; // Ошибка уже отправлена через reject в timeout
        }
        
        if (code === 0) {
          resolve(stdout);
        } else {
          // Парсим ошибки yt-dlp
          const error = new Error(stderr || 'yt-dlp command failed');
          error.code = code;
          error.stderr = stderr;
          reject(error);
        }
      });
      
      // Обрабатываем ошибки запуска процесса
      process.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Получает полную информацию о видео
   * @param {string} url - YouTube URL
   * @returns {Promise<Object>} - объект с информацией о видео
   * @throws {Error} - если не удалось получить информацию
   */
  async getVideoInfo(url) {
    const args = ['-j', '--no-warnings', url];
    const timeout = config.YTDLP_METADATA_TIMEOUT;
    
    try {
      const stdout = await this.executeYtDlp(args, timeout);
      const videoInfo = JSON.parse(stdout);
      
      return {
        id: videoInfo.id,
        title: videoInfo.title,
        duration: videoInfo.duration,
        thumbnail: videoInfo.thumbnail,
        uploader: videoInfo.uploader,
        formats: videoInfo.formats || []
      };
    } catch (error) {
      if (error.message === 'TIMEOUT') {
        throw new Error('TIMEOUT');
      }
      
      // Проверяем специфичные ошибки yt-dlp
      if (error.stderr) {
        if (error.stderr.includes('Video unavailable') || 
            error.stderr.includes('Private video') ||
            error.stderr.includes('This video is not available')) {
          throw new Error('VIDEO_UNAVAILABLE');
        }
        
        if (error.stderr.includes('network') || 
            error.stderr.includes('Connection') ||
            error.stderr.includes('timed out')) {
          throw new Error('NETWORK_ERROR');
        }
      }
      
      throw new Error('UNKNOWN_ERROR');
    }
  }

  /**
   * Получает список доступных форматов видео
   * @param {string} url - YouTube URL
   * @returns {Promise<Array>} - массив отфильтрованных и отсортированных форматов
   * @throws {Error} - если не удалось получить форматы
   */
  async getFormats(url) {
    const videoInfo = await this.getVideoInfo(url);
    return this.filterAndSortFormats(videoInfo.formats);
  }

  /**
   * Получает прямую ссылку на скачивание для конкретного формата
   * @param {string} url - YouTube URL
   * @param {string} formatId - ID формата
   * @returns {Promise<string>} - прямая ссылка на скачивание
   * @throws {Error} - если не удалось получить ссылку
   */
  async getDirectUrl(url, formatId) {
    const args = ['-f', formatId, '-g', '--no-warnings', url];
    const timeout = config.YTDLP_URL_TIMEOUT;
    
    try {
      const stdout = await this.executeYtDlp(args, timeout);
      const directUrl = stdout.trim();
      
      if (!directUrl || !directUrl.startsWith('http')) {
        throw new Error('FORMAT_UNAVAILABLE');
      }
      
      return directUrl;
    } catch (error) {
      if (error.message === 'TIMEOUT') {
        throw new Error('TIMEOUT');
      }
      
      if (error.stderr && error.stderr.includes('requested format not available')) {
        throw new Error('FORMAT_UNAVAILABLE');
      }
      
      if (error.stderr && (error.stderr.includes('network') || error.stderr.includes('Connection'))) {
        throw new Error('NETWORK_ERROR');
      }
      
      throw new Error('UNKNOWN_ERROR');
    }
  }

  /**
   * Скачивает видео и возвращает путь к файлу
   * @param {string} url - YouTube URL
   * @param {string} formatId - ID формата
   * @param {string} outputPath - путь для сохранения файла
   * @param {number} timeout - timeout в миллисекундах
   * @returns {Promise<string>} - путь к скачанному файлу
   * @throws {Error} - если не удалось скачать
   */
  async downloadVideo(url, formatId, outputPath, timeout = 300000) {
    // Для комбинированных форматов yt-dlp автоматически объединит видео и аудио
    const args = [
      '-f', formatId,
      '--merge-output-format', 'mp4', // Объединяем в mp4
      '-o', outputPath,
      '--no-warnings',
      url
    ];
    
    try {
      await this.executeYtDlp(args, timeout);
      return outputPath;
    } catch (error) {
      if (error.message === 'TIMEOUT') {
        throw new Error('TIMEOUT');
      }
      
      if (error.stderr && error.stderr.includes('requested format not available')) {
        throw new Error('FORMAT_UNAVAILABLE');
      }
      
      if (error.stderr && (error.stderr.includes('network') || error.stderr.includes('Connection'))) {
        throw new Error('NETWORK_ERROR');
      }
      
      throw new Error('UNKNOWN_ERROR');
    }
  }

  /**
   * Скачивает отдельный поток (видео или аудио)
   * @param {string} url - YouTube URL
   * @param {string} formatId - ID формата
   * @param {string} outputPath - путь для сохранения файла
   * @param {number} timeout - timeout в миллисекундах
   * @returns {Promise<string>} - путь к скачанному файлу
   */
  async downloadStream(url, formatId, outputPath, timeout = 300000) {
    const args = [
      '-f', formatId,
      '-o', outputPath,
      '--no-warnings',
      url
    ];
    
    try {
      await this.executeYtDlp(args, timeout);
      return outputPath;
    } catch (error) {
      // Логируем детали ошибки для отладки
      const { Logger } = require('./utils');
      Logger.error('Download stream failed', error, { 
        formatId, 
        outputPath,
        stderr: error.stderr || 'no stderr',
        message: error.message 
      });
      
      if (error.message === 'TIMEOUT') {
        throw new Error('TIMEOUT');
      }
      
      if (error.stderr) {
        if (error.stderr.includes('requested format not available') || 
            error.stderr.includes('Requested format is not available')) {
          throw new Error('FORMAT_UNAVAILABLE');
        }
        
        if (error.stderr.includes('network') || error.stderr.includes('Connection')) {
          throw new Error('NETWORK_ERROR');
        }
      }
      
      // Передаем оригинальную ошибку с деталями
      const detailedError = new Error('DOWNLOAD_FAILED');
      detailedError.originalError = error;
      detailedError.stderr = error.stderr;
      throw detailedError;
    }
  }

  /**
   * Получает лучший аудио формат для видео
   * @param {Array} formats - массив всех форматов
   * @returns {Object|null} - лучший аудио формат или null
   */
  getBestAudioFormat(formats) {
    const audioFormats = formats.filter(f => 
      f.acodec && f.acodec !== 'none' && 
      (!f.vcodec || f.vcodec === 'none')
    );
    
    if (audioFormats.length === 0) {
      return null;
    }
    
    // Приоритет форматов аудио (от лучшего к худшему)
    const PREFERRED_AUDIO_FORMATS = ['251', '140', '139', '250', '249'];
    
    // Сначала пытаемся найти предпочтительные форматы
    for (const preferredId of PREFERRED_AUDIO_FORMATS) {
      const format = audioFormats.find(f => f.format_id === preferredId);
      if (format) {
        return format;
      }
    }
    
    // Если предпочтительные не найдены, сортируем по битрейту
    audioFormats.sort((a, b) => {
      const bitrateA = a.abr || 0;
      const bitrateB = b.abr || 0;
      return bitrateB - bitrateA;
    });
    
    return audioFormats[0];
  }

  /**
   * Проверяет, является ли формат комбинированным (видео+аудио)
   * @param {Object} format - объект формата
   * @returns {boolean}
   */
  isCombinedFormat(format) {
    return format.vcodec && format.vcodec !== 'none' && 
           format.acodec && format.acodec !== 'none';
  }

  /**
   * Фильтрует и сортирует форматы видео
   * @private
   * @param {Array} formats - массив форматов от yt-dlp
   * @returns {Array} - отфильтрованный и отсортированный массив форматов
   */
  filterAndSortFormats(formats) {
    // Популярные разрешения
    const POPULAR_RESOLUTIONS = ['1080p', '720p', '480p', '360p', '240p'];
    
    // Шаг 1: Разделяем форматы на комбинированные и только видео
    const combinedFormats = formats.filter(f => 
      f.vcodec && f.vcodec !== 'none' && 
      f.acodec && f.acodec !== 'none'
    );
    
    const videoOnlyFormats = formats.filter(f =>
      f.vcodec && f.vcodec !== 'none' &&
      (!f.acodec || f.acodec === 'none')
    );
    
    // Шаг 2: Фильтрация комбинированных форматов по популярным разрешениям
    const popularCombined = combinedFormats.filter(f => {
      if (f.format_note && POPULAR_RESOLUTIONS.includes(f.format_note)) {
        return true;
      }
      if (f.height) {
        const resolution = `${f.height}p`;
        return POPULAR_RESOLUTIONS.includes(resolution);
      }
      return false;
    });
    
    // Шаг 3: Фильтрация видео-only форматов по популярным разрешениям
    const popularVideoOnly = videoOnlyFormats.filter(f => {
      if (f.format_note && POPULAR_RESOLUTIONS.includes(f.format_note)) {
        return true;
      }
      if (f.height) {
        const resolution = `${f.height}p`;
        return POPULAR_RESOLUTIONS.includes(resolution);
      }
      return false;
    });
    
    // Шаг 4: Группировка всех форматов по разрешению
    const groupedByResolution = {};
    
    // Добавляем комбинированные форматы
    popularCombined.forEach(format => {
      const resolution = format.format_note || `${format.height}p`;
      if (!groupedByResolution[resolution]) {
        groupedByResolution[resolution] = { combined: [], videoOnly: [] };
      }
      groupedByResolution[resolution].combined.push(format);
    });
    
    // Добавляем видео-only форматы
    popularVideoOnly.forEach(format => {
      const resolution = format.format_note || `${format.height}p`;
      if (!groupedByResolution[resolution]) {
        groupedByResolution[resolution] = { combined: [], videoOnly: [] };
      }
      groupedByResolution[resolution].videoOnly.push(format);
    });
    
    // Шаг 5: Для каждого разрешения выбираем лучший формат
    const bestFormats = [];
    
    for (const resolution in groupedByResolution) {
      const { combined, videoOnly } = groupedByResolution[resolution];
      
      // Если есть комбинированные форматы, выбираем лучший из них
      if (combined.length > 0) {
        const bestCombined = combined.reduce((best, current) => {
          if (!best.filesize && !current.filesize) return best;
          if (!best.filesize) return current;
          if (!current.filesize) return best;
          return current.filesize < best.filesize ? current : best;
        });
        bestCombined.isCombined = true;
        bestCombined.needsMerge = false;
        bestFormats.push(bestCombined);
      }
      // Если есть только видео-only форматы, выбираем лучший
      else if (videoOnly.length > 0) {
        const bestVideoOnly = videoOnly.reduce((best, current) => {
          if (!best.filesize && !current.filesize) return best;
          if (!best.filesize) return current;
          if (!current.filesize) return best;
          return current.filesize < best.filesize ? current : best;
        });
        bestVideoOnly.isCombined = false;
        bestVideoOnly.needsMerge = true;
        bestFormats.push(bestVideoOnly);
      }
    }
    
    // Шаг 6: Сортировка от высокого качества к низкому
    bestFormats.sort((a, b) => {
      const heightA = a.height || 0;
      const heightB = b.height || 0;
      return heightB - heightA;
    });
    
    return bestFormats;
  }
}

module.exports = VideoProcessor;
