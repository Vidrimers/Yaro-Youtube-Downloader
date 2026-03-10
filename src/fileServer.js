const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('./utils');

/**
 * FileServer - HTTP сервер для раздачи временных файлов
 * Создает временные ссылки на файлы с автоудалением
 */
class FileServer {
  constructor(port = 3001, baseUrl = null, options = {}) {
    this.port = port;
    this.baseUrl = baseUrl || `http://localhost:${port}`;
    this.app = express();
    this.server = null;
    this.temporaryFiles = new Map(); // Map<fileId, {filePath, expiresAt, originalName}>
    this.cleanupInterval = null;
    
    // Опции управления ресурсами
    this.maxConcurrentFiles = options.maxConcurrentFiles || 50;
    this.autoDeleteAfterDownload = options.autoDeleteAfterDownload !== undefined ? options.autoDeleteAfterDownload : true;
    this.minFreeSpaceGB = options.minFreeSpaceGB || 5;
    
    this.setupRoutes();
  }

  /**
   * Настройка маршрутов Express
   */
  setupRoutes() {
    // Маршрут для скачивания файлов
    this.app.get('/download/:fileId', async (req, res) => {
      const { fileId } = req.params;
      
      try {
        const fileInfo = this.temporaryFiles.get(fileId);
        
        if (!fileInfo) {
          Logger.warn('File not found or expired', { fileId });
          return res.status(404).json({ error: 'File not found or expired' });
        }
        
        // Проверяем, не истек ли срок действия
        if (Date.now() > fileInfo.expiresAt) {
          Logger.info('File expired, removing', { fileId });
          await this.removeFile(fileId);
          return res.status(404).json({ error: 'File expired' });
        }
        
        // Проверяем, существует ли файл на диске
        try {
          await fs.access(fileInfo.filePath);
        } catch (error) {
          Logger.warn('File not found on disk', { fileId, filePath: fileInfo.filePath });
          this.temporaryFiles.delete(fileId);
          return res.status(404).json({ error: 'File not found' });
        }
        
        // Отправляем файл
        Logger.info('Serving file', { fileId, originalName: fileInfo.originalName, filePath: fileInfo.filePath });
        
        // Кодируем имя файла для поддержки кириллицы и других не-ASCII символов
        // Используем RFC 5987 формат: filename*=UTF-8''encoded_filename
        const encodedFilename = encodeURIComponent(fileInfo.originalName);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        
        res.sendFile(path.resolve(fileInfo.filePath), (err) => {
          if (err) {
            // Если клиент прервал загрузку (закрыл вкладку/отменил), это не критичная ошибка
            if (err.message === 'Request aborted') {
              Logger.warn('File download aborted by client', { 
                fileId, 
                filePath: fileInfo.filePath,
                originalName: fileInfo.originalName
              });
            } else {
              Logger.error('Error sending file', err, { 
                fileId, 
                filePath: fileInfo.filePath,
                errorMessage: err.message 
              });
            }
            
            // Если заголовки еще не отправлены, отправляем ошибку
            if (!res.headersSent) {
              res.status(500).json({ error: 'Error sending file', details: err.message });
            }
          } else {
            Logger.info('File sent successfully', { fileId, originalName: fileInfo.originalName });
            
            // Автоудаление файла после успешного скачивания
            if (this.autoDeleteAfterDownload) {
              Logger.info('Auto-deleting file after successful download', { fileId });
              this.removeFile(fileId).catch(removeErr => {
                Logger.error('Error auto-deleting file', removeErr, { fileId });
              });
            }
          }
        });
        
      } catch (error) {
        Logger.error('Error serving file', error, { 
          fileId, 
          errorMessage: error.message,
          errorStack: error.stack 
        });
        res.status(500).json({ error: 'Internal server error', details: error.message });
      }
    });

    // Маршрут для проверки статуса файла
    this.app.get('/status/:fileId', (req, res) => {
      const { fileId } = req.params;
      const fileInfo = this.temporaryFiles.get(fileId);
      
      if (!fileInfo) {
        return res.status(404).json({ exists: false });
      }
      
      const now = Date.now();
      const timeLeft = Math.max(0, fileInfo.expiresAt - now);
      
      res.json({
        exists: true,
        expiresAt: fileInfo.expiresAt,
        timeLeftMs: timeLeft,
        originalName: fileInfo.originalName
      });
    });
  }

  /**
   * Запуск сервера
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (error) => {
        if (error) {
          Logger.error('Failed to start file server', error, { port: this.port });
          reject(error);
        } else {
          Logger.info('File server started', { port: this.port, baseUrl: this.baseUrl });
          
          // Запускаем периодическую очистку каждую минуту
          this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredFiles();
          }, 60000);
          
          resolve();
        }
      });
    });
  }

  /**
   * Остановка сервера
   */
  async stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          Logger.info('File server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Создание временной ссылки на файл
   * @param {string} filePath - путь к файлу
   * @param {string} originalName - оригинальное имя файла
   * @param {number} ttlMinutes - время жизни в минутах (по умолчанию 10)
   * @returns {Object} - объект с fileId и downloadUrl
   * @throws {Error} - если недостаточно ресурсов
   */
  async createTemporaryLink(filePath, originalName, ttlMinutes = 10) {
    // Проверка лимита одновременных файлов
    if (this.temporaryFiles.size >= this.maxConcurrentFiles) {
      Logger.warn('Max concurrent files limit reached', { 
        current: this.temporaryFiles.size, 
        max: this.maxConcurrentFiles 
      });
      throw new Error('MAX_CONCURRENT_FILES_REACHED');
    }
    
    // Проверка свободного места на диске
    const freeSpaceGB = await this.checkFreeSpace();
    if (freeSpaceGB !== null && freeSpaceGB < this.minFreeSpaceGB) {
      Logger.warn('Insufficient disk space', { 
        freeSpaceGB, 
        minRequired: this.minFreeSpaceGB 
      });
      throw new Error('INSUFFICIENT_DISK_SPACE');
    }
    
    const fileId = this.generateFileId();
    const expiresAt = Date.now() + (ttlMinutes * 60 * 1000);
    
    this.temporaryFiles.set(fileId, {
      filePath: path.resolve(filePath),
      expiresAt,
      originalName
    });
    
    const downloadUrl = `${this.baseUrl}/download/${fileId}`;
    
    Logger.info('Created temporary link', { 
      fileId, 
      originalName, 
      ttlMinutes,
      expiresAt: new Date(expiresAt).toISOString(),
      currentFiles: this.temporaryFiles.size,
      freeSpaceGB
    });
    
    return {
      fileId,
      downloadUrl,
      expiresAt,
      ttlMinutes
    };
  }
  
  /**
   * Проверка свободного места на диске
   * @returns {Promise<number|null>} - свободное место в GB или null если не удалось проверить
   */
  async checkFreeSpace() {
    try {
      const { execSync } = require('child_process');
      
      // Определяем команду в зависимости от ОС
      let command;
      if (process.platform === 'win32') {
        // Windows: используем wmic
        command = 'wmic logicaldisk get size,freespace,caption';
      } else {
        // Linux/Mac: используем df
        command = `df -k "${this.temporaryFiles.size > 0 ? Array.from(this.temporaryFiles.values())[0].filePath : process.cwd()}" | tail -1`;
      }
      
      const output = execSync(command, { encoding: 'utf8' });
      
      if (process.platform === 'win32') {
        // Парсим вывод Windows
        const lines = output.trim().split('\n');
        if (lines.length > 1) {
          const dataLine = lines[1].trim().split(/\s+/);
          if (dataLine.length >= 2) {
            const freeBytes = parseInt(dataLine[1], 10);
            return freeBytes / (1024 * 1024 * 1024); // Конвертируем в GB
          }
        }
      } else {
        // Парсим вывод Linux/Mac
        const parts = output.trim().split(/\s+/);
        if (parts.length >= 4) {
          const freeKB = parseInt(parts[3], 10);
          return freeKB / (1024 * 1024); // Конвертируем в GB
        }
      }
      
      return null;
    } catch (error) {
      Logger.warn('Could not check free disk space', { error: error.message });
      return null;
    }
  }

  /**
   * Удаление файла и его ссылки
   * @param {string} fileId - ID файла
   */
  async removeFile(fileId) {
    const fileInfo = this.temporaryFiles.get(fileId);
    
    if (fileInfo) {
      try {
        await fs.unlink(fileInfo.filePath);
        Logger.info('File deleted from disk', { fileId, filePath: fileInfo.filePath });
      } catch (error) {
        Logger.warn('Could not delete file from disk', { fileId, error: error.message });
      }
      
      this.temporaryFiles.delete(fileId);
      Logger.info('File removed from temporary links', { fileId });
    }
  }

  /**
   * Очистка истекших файлов
   */
  async cleanupExpiredFiles() {
    const now = Date.now();
    const expiredFiles = [];
    
    for (const [fileId, fileInfo] of this.temporaryFiles.entries()) {
      if (now > fileInfo.expiresAt) {
        expiredFiles.push(fileId);
      }
    }
    
    if (expiredFiles.length > 0) {
      Logger.info('Cleaning up expired files', { count: expiredFiles.length });
      
      for (const fileId of expiredFiles) {
        await this.removeFile(fileId);
      }
    }
  }

  /**
   * Генерация уникального ID файла
   * @returns {string}
   */
  generateFileId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  /**
   * Получение статистики сервера
   * @returns {Object}
   */
  getStats() {
    const now = Date.now();
    let activeFiles = 0;
    let expiredFiles = 0;
    
    for (const fileInfo of this.temporaryFiles.values()) {
      if (now > fileInfo.expiresAt) {
        expiredFiles++;
      } else {
        activeFiles++;
      }
    }
    
    return {
      activeFiles,
      expiredFiles,
      totalFiles: this.temporaryFiles.size,
      serverRunning: !!this.server
    };
  }
}

module.exports = FileServer;