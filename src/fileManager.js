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
   * Вырезает сегменты из видео (удаляет рекламные блоки).
   * Использует stream copy — без перекодирования, быстро и не жрёт память.
   * Небольшая неточность на стыках (+-1 сек) допустима для удаления рекламы.
   */
  async removeSegments(inputPath, outputPath, segments) {
    if (!segments || segments.length === 0) {
      throw new Error('NO_SEGMENTS_PROVIDED');
    }

    Logger.info('Removing segments from video (stream copy)', {
      inputPath,
      segmentsCount: segments.length
    });

    const sortedSegments = segments
      .map(s => ({ start: s.segment[0], end: s.segment[1] }))
      .sort((a, b) => a.start - b.start);

    const keepParts = [];
    let lastEnd = 0;

    sortedSegments.forEach(segment => {
      if (segment.start > lastEnd) {
        keepParts.push({ start: lastEnd, end: segment.start });
      }
      lastEnd = segment.end;
    });
    keepParts.push({ start: lastEnd, end: null }); // null = до конца файла

    Logger.info('Video parts to keep', { partsCount: keepParts.length });

    const fsSync = require('fs');
    const partPaths = [];

    try {
      // Нарезаем каждую часть отдельным ffmpeg -c copy
      for (let i = 0; i < keepParts.length; i++) {
        const part = keepParts[i];
        const partPath = path.resolve(
          path.dirname(outputPath),
          '_part_' + i + '_' + path.basename(outputPath)
        );
        partPaths.push(partPath);
        await this._ffmpegCopyPart(inputPath, partPath, part.start, part.end);
      }

      // Создаём concat list файл
      const concatListPath = path.resolve(
        path.dirname(outputPath),
        '_concat_' + Date.now() + '.txt'
      );
      const concatContent = partPaths.map(p => `file ${p}`).join(String.fromCharCode(10));
      fsSync.writeFileSync(concatListPath, concatContent, 'utf8');

      // Склеиваем части через concat demuxer
      await this._ffmpegConcat(concatListPath, outputPath);

      // Удаляем временные файлы
      try { fsSync.unlinkSync(concatListPath); } catch {}
      for (const p of partPaths) {
        try { fsSync.unlinkSync(p); } catch {}
      }

      Logger.info('Segments removed successfully', { outputPath });
      return outputPath;

    } catch (error) {
      for (const p of partPaths) {
        try { fsSync.unlinkSync(p); } catch {}
      }
      throw error;
    }
  }

  /** Копирует часть видео без перекодирования */
  _ffmpegCopyPart(inputPath, outputPath, start, end) {
    return new Promise((resolve, reject) => {
      const args = ['-ss', String(start), '-i', inputPath, '-c', 'copy'];
      if (end !== null) {
        args.push('-t', String(end - start));
      }
      args.push('-avoid_negative_ts', 'make_zero', '-y', outputPath);

      const ffmpeg = require('child_process').spawn('ffmpeg', args);
      let stderr = '';
      ffmpeg.stderr.on('data', d => { stderr += d.toString(); });

      const timeoutId = setTimeout(() => {
        ffmpeg.kill('SIGKILL');
        reject(new Error('REMOVE_SEGMENTS_TIMEOUT'));
      }, this.mergeTimeout);

      ffmpeg.on('close', code => {
        clearTimeout(timeoutId);
        if (code === 0) resolve();
        else {
          Logger.error('ffmpeg copy part failed', new Error(stderr), { code });
          reject(new Error('REMOVE_SEGMENTS_FAILED'));
        }
      });
      ffmpeg.on('error', err => { clearTimeout(timeoutId); reject(err); });
    });
  }

  /**
   * Обрезает видео по времени начала и конца (без перекодирования).
   * @param {string} inputPath - путь к исходному видео
   * @param {string} outputPath - путь для сохранения результата
   * @param {number|null} startSeconds - время начала в секундах (null = с самого начала)
   * @param {number|null} endSeconds - время конца в секундах (null = до конца)
   * @returns {Promise<string>} - путь к обрезанному файлу
   */
  async trimVideo(inputPath, outputPath, startSeconds, endSeconds) {
    return new Promise((resolve, reject) => {
      const args = [];
      if (startSeconds > 0) {
        args.push('-ss', String(startSeconds));
      }
      args.push('-i', inputPath);
      if (endSeconds !== null && endSeconds !== undefined) {
        if (startSeconds > 0) {
          args.push('-t', String(endSeconds - startSeconds));
        } else {
          args.push('-to', String(endSeconds));
        }
      }
      args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', outputPath);

      Logger.info('Trimming video', { inputPath, outputPath, startSeconds, endSeconds });

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        ffmpeg.kill('SIGKILL');
        reject(new Error('TRIM_TIMEOUT'));
      }, this.mergeTimeout);

      ffmpeg.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          Logger.info('Video trimmed successfully', { outputPath });
          resolve(outputPath);
        } else {
          Logger.error('ffmpeg trim failed', new Error(stderr), { code });
          reject(new Error('TRIM_FAILED'));
        }
      });

      ffmpeg.on('error', (error) => {
        clearTimeout(timeoutId);
        Logger.error('ffmpeg trim process error', error);
        reject(error);
      });
    });
  }

  /** Склеивает части видео через concat demuxer (без перекодирования) */
  _ffmpegConcat(concatListPath, outputPath) {
    return new Promise((resolve, reject) => {
      const ffmpeg = require('child_process').spawn('ffmpeg', [
        '-f', 'concat', '-safe', '0', '-i', concatListPath,
        '-c', 'copy', '-y', outputPath
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', d => { stderr += d.toString(); });

      const timeoutId = setTimeout(() => {
        ffmpeg.kill('SIGKILL');
        reject(new Error('REMOVE_SEGMENTS_TIMEOUT'));
      }, this.mergeTimeout);

      ffmpeg.on('close', code => {
        clearTimeout(timeoutId);
        if (code === 0) resolve();
        else {
          Logger.error('ffmpeg concat failed', new Error(stderr), { code });
          reject(new Error('REMOVE_SEGMENTS_FAILED'));
        }
      });
      ffmpeg.on('error', err => { clearTimeout(timeoutId); reject(err); });
    });
  }

}

module.exports = FileManager;
