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
   * Фильтрует и сортирует форматы видео
   * @private
   * @param {Array} formats - массив форматов от yt-dlp
   * @returns {Array} - отфильтрованный и отсортированный массив форматов
   */
  filterAndSortFormats(formats) {
    // Популярные разрешения
    const POPULAR_RESOLUTIONS = ['1080p', '720p', '480p', '360p', '240p'];
    
    // Шаг 1: Базовая фильтрация - только форматы с видео и аудио
    const withVideoAndAudio = formats.filter(f => 
      f.vcodec && f.vcodec !== 'none' && 
      f.acodec && f.acodec !== 'none'
    );
    
    // Шаг 2: Фильтрация по популярным разрешениям
    const popularFormats = withVideoAndAudio.filter(f => {
      // Проверяем format_note (например, "1080p", "720p")
      if (f.format_note && POPULAR_RESOLUTIONS.includes(f.format_note)) {
        return true;
      }
      
      // Если format_note нет, проверяем по высоте
      if (f.height) {
        const resolution = `${f.height}p`;
        return POPULAR_RESOLUTIONS.includes(resolution);
      }
      
      return false;
    });
    
    // Шаг 3: Группировка по разрешению и выбор формата с меньшим размером
    const groupedByResolution = {};
    
    popularFormats.forEach(format => {
      const resolution = format.format_note || `${format.height}p`;
      
      if (!groupedByResolution[resolution]) {
        groupedByResolution[resolution] = [];
      }
      
      groupedByResolution[resolution].push(format);
    });
    
    // Для каждого разрешения выбираем формат с меньшим размером
    const bestFormats = [];
    
    for (const resolution in groupedByResolution) {
      const formatsForResolution = groupedByResolution[resolution];
      
      // Выбираем формат с меньшим размером (или первый, если размер неизвестен)
      const bestFormat = formatsForResolution.reduce((best, current) => {
        // Если у обоих нет размера, берем первый
        if (!best.filesize && !current.filesize) {
          return best;
        }
        
        // Если у одного нет размера, берем тот, у которого есть
        if (!best.filesize) return current;
        if (!current.filesize) return best;
        
        // Берем с меньшим размером
        return current.filesize < best.filesize ? current : best;
      });
      
      bestFormats.push(bestFormat);
    }
    
    // Шаг 4: Сортировка от высокого качества к низкому
    bestFormats.sort((a, b) => {
      const heightA = a.height || 0;
      const heightB = b.height || 0;
      return heightB - heightA;
    });
    
    return bestFormats;
  }
}

module.exports = VideoProcessor;
