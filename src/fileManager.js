const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { Logger } = require('./utils');

/**
 * FileManager - класс для управления файлами и объединения видео/аудио через ffmpeg
 */
class FileManager {
  /**
   * @param {string} tempDir - директория для временных файлов
   * @param {number} mergeTimeout - timeout для объединения в миллисекундах
   */
  constructor(tempDir, mergeTimeout) {
    this.tempDir = tempDir;
    this.mergeTimeout = mergeTimeout;
  }

  /**
   * Инициализация - создание директории для временных файлов
   */
  async initialize() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      Logger.info('Temp directory initialized', { path: this.tempDir });
    } catch (error) {
      Logger.error('Failed to create temp directory', error);
      throw error;
    }
  }

  /**
   * Генерирует уникальное имя файла
   * @param {string} videoId - ID видео
   * @param {string} extension - расширение файла
   * @returns {string} - полный путь к файлу
   */
  generateFilePath(videoId, extension) {
    const timestamp = Date.now();
    const filename = `${videoId}_${timestamp}.${extension}`;
    return path.join(this.tempDir, filename);
  }

  /**
   * Объединяет видео и аудио файлы с помощью ffmpeg
   * @param {string} videoPath - путь к видео файлу
   * @param {string} audioPath - путь к аудио файлу
   * @param {string} outputPath - путь для сохранения результата
   * @returns {Promise<string>} - путь к объединенному файлу
   */
  async mergeVideoAudio(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
      let timedOut = false;
      
      // Запускаем ffmpeg
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-i', audioPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-strict', 'experimental',
        outputPath
      ]);

      let stderr = '';

      // Устанавливаем timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        ffmpeg.kill('SIGTERM');
        
        setTimeout(() => {
          if (!ffmpeg.killed) {
            ffmpeg.kill('SIGKILL');
          }
        }, 1000);
        
        reject(new Error('MERGE_TIMEOUT'));
      }, this.mergeTimeout);

      // Собираем stderr для логирования
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Обрабатываем завершение
      ffmpeg.on('close', (code) => {
        clearTimeout(timeoutId);
        
        if (timedOut) {
          return;
        }
        
        if (code === 0) {
          Logger.info('Video and audio merged successfully', { outputPath });
          resolve(outputPath);
        } else {
          Logger.error('ffmpeg merge failed', new Error(stderr), { code });
          reject(new Error('MERGE_FAILED'));
        }
      });

      ffmpeg.on('error', (error) => {
        clearTimeout(timeoutId);
        Logger.error('ffmpeg process error', error);
        reject(error);
      });
    });
  }

  /**
   * Получает размер файла
   * @param {string} filePath - путь к файлу
   * @returns {Promise<number>} - размер файла в байтах
   */
  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      Logger.error('Failed to get file size', error, { filePath });
      throw error;
    }
  }

  /**
   * Удаляет файл
   * @param {string} filePath - путь к файлу
   */
  async deleteFile(filePath) {
    try {
      await fs.unlink(filePath);
      Logger.info('File deleted', { filePath });
    } catch (error) {
      // Игнорируем ошибку если файл не существует
      if (error.code !== 'ENOENT') {
        Logger.error('Failed to delete file', error, { filePath });
      }
    }
  }

  /**
   * Удаляет несколько файлов
   * @param {string[]} filePaths - массив путей к файлам
   */
  async deleteFiles(filePaths) {
    await Promise.all(filePaths.map(path => this.deleteFile(path)));
  }

  /**
   * Очищает старые файлы из временной директории
   * @param {number} maxAge - максимальный возраст файла в миллисекундах
   */
  async cleanupOldFiles(maxAge) {
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        
        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtimeMs;

          if (age > maxAge) {
            await this.deleteFile(filePath);
            deletedCount++;
          }
        } catch (error) {
          Logger.error('Error checking file age', error, { file });
        }
      }

      if (deletedCount > 0) {
        Logger.info('Cleanup completed', { deletedFiles: deletedCount });
      }
    } catch (error) {
      Logger.error('Cleanup failed', error);
    }
  }

  /**
   * Проверяет доступность ffmpeg
   * @returns {Promise<boolean>}
   */
  async checkFfmpegAvailable() {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ['-version']);
      
      ffmpeg.on('close', (code) => {
        resolve(code === 0);
      });
      
      ffmpeg.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Вырезает сегменты из видео (удаляет рекламные блоки)
   * @param {string} inputPath - путь к исходному видео
   * @param {string} outputPath - путь для сохранения результата
   * @param {Array} segments - массив сегментов для удаления [{start, end}, ...]
   * @returns {Promise<string>} - путь к обработанному файлу
   */
  async removeSegments(inputPath, outputPath, segments) {
    return new Promise((resolve, reject) => {
      if (!segments || segments.length === 0) {
        reject(new Error('NO_SEGMENTS_PROVIDED'));
        return;
      }

      Logger.info('Removing segments from video', { 
        inputPath, 
        segmentsCount: segments.length 
      });

      // Сортируем сегменты по времени начала
      const sortedSegments = segments
        .map(s => ({ start: s.segment[0], end: s.segment[1] }))
        .sort((a, b) => a.start - b.start);

      // Создаем список частей видео, которые нужно оставить
      const keepParts = [];
      let lastEnd = 0;

      sortedSegments.forEach(segment => {
        // Добавляем часть до текущего сегмента
        if (segment.start > lastEnd) {
          keepParts.push({ start: lastEnd, end: segment.start });
        }
        lastEnd = segment.end;
      });

      // Добавляем последнюю часть (от последнего сегмента до конца)
      // Используем большое число как "конец видео"
      keepParts.push({ start: lastEnd, end: 999999 });

      Logger.info('Video parts to keep', { partsCount: keepParts.length });

      // Создаем filter_complex для ffmpeg
      let filterComplex = '';
      let concatInputs = '';

      keepParts.forEach((part, index) => {
        const duration = part.end - part.start;
        filterComplex += `[0:v]trim=start=${part.start}:duration=${duration},setpts=PTS-STARTPTS[v${index}];`;
        filterComplex += `[0:a]atrim=start=${part.start}:duration=${duration},asetpts=PTS-STARTPTS[a${index}];`;
        concatInputs += `[v${index}][a${index}]`;
      });

      filterComplex += `${concatInputs}concat=n=${keepParts.length}:v=1:a=1[outv][outa]`;

      let timedOut = false;

      // Запускаем ffmpeg с filter_complex
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-c:a', 'aac',
        outputPath
      ]);

      let stderr = '';

      // Устанавливаем timeout (увеличенный, т.к. перекодирование медленнее)
      const timeoutId = setTimeout(() => {
        timedOut = true;
        ffmpeg.kill('SIGTERM');
        
        setTimeout(() => {
          if (!ffmpeg.killed) {
            ffmpeg.kill('SIGKILL');
          }
        }, 1000);
        
        reject(new Error('REMOVE_SEGMENTS_TIMEOUT'));
      }, this.mergeTimeout * 3); // Утроенный timeout для перекодирования

      // Собираем stderr для логирования
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Обрабатываем завершение
      ffmpeg.on('close', (code) => {
        clearTimeout(timeoutId);
        
        if (timedOut) {
          return;
        }
        
        if (code === 0) {
          Logger.info('Segments removed successfully', { outputPath });
          resolve(outputPath);
        } else {
          Logger.error('ffmpeg remove segments failed', new Error(stderr), { code });
          reject(new Error('REMOVE_SEGMENTS_FAILED'));
        }
      });

      ffmpeg.on('error', (error) => {
        clearTimeout(timeoutId);
        Logger.error('ffmpeg process error during segment removal', error);
        reject(error);
      });
    });
  }
}

module.exports = FileManager;
