/**
 * Модуль вспомогательных утилит для YouTube Downloader Bot
 */

/**
 * URLValidator - класс для валидации и обработки YouTube URL
 */
class URLValidator {
  /**
   * Проверяет, является ли URL валидным YouTube URL
   * @param {string} url - URL для проверки
   * @returns {boolean} - true если URL валидный YouTube URL
   */
  static isYouTubeUrl(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      // Поддерживаемые домены
      const validDomains = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'];
      
      if (!validDomains.includes(hostname)) {
        return false;
      }

      // Для youtube.com проверяем наличие параметра v
      if (hostname.includes('youtube.com')) {
        return urlObj.pathname === '/watch' && urlObj.searchParams.has('v');
      }

      // Для youtu.be проверяем наличие video ID в pathname
      if (hostname === 'youtu.be') {
        return urlObj.pathname.length > 1;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Извлекает video ID из YouTube URL
   * @param {string} url - YouTube URL
   * @returns {string|null} - video ID или null если не найден
   */
  static extractVideoId(url) {
    if (!this.isYouTubeUrl(url)) {
      return null;
    }

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      // Для youtube.com извлекаем из параметра v
      if (hostname.includes('youtube.com')) {
        const videoId = urlObj.searchParams.get('v');
        return videoId && videoId.length === 11 ? videoId : null;
      }

      // Для youtu.be извлекаем из pathname
      if (hostname === 'youtu.be') {
        const videoId = urlObj.pathname.substring(1).split('?')[0];
        return videoId && videoId.length === 11 ? videoId : null;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Нормализует YouTube URL к стандартному формату
   * @param {string} url - YouTube URL
   * @returns {string} - нормализованный URL в формате https://www.youtube.com/watch?v=VIDEO_ID
   */
  static normalizeUrl(url) {
    const videoId = this.extractVideoId(url);
    
    if (!videoId) {
      return url;
    }

    return `https://www.youtube.com/watch?v=${videoId}`;
  }
}

/**
 * Formatter - класс для форматирования данных
 */
class Formatter {
  /**
   * Форматирует размер файла в человекочитаемый формат
   * @param {number} bytes - размер в байтах
   * @returns {string} - отформатированный размер (B, KB, MB, GB)
   */
  static formatFileSize(bytes) {
    if (typeof bytes !== 'number' || bytes < 0) {
      return '0 B';
    }

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1048576) { // 1024 * 1024
      return `${Math.round(bytes / 1024)} KB`;
    }

    if (bytes < 1073741824) { // 1024 * 1024 * 1024
      return `${Math.round(bytes / 1048576)} MB`;
    }

    return `${Math.round(bytes / 1073741824)} GB`;
  }

  /**
   * Форматирует длительность в человекочитаемый формат
   * @param {number} seconds - длительность в секундах
   * @returns {string} - отформатированная длительность (SS, MM:SS, HH:MM:SS)
   */
  static formatDuration(seconds) {
    if (typeof seconds !== 'number' || seconds < 0) {
      return '0:00';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (seconds < 60) {
      return `0:${secs.toString().padStart(2, '0')}`;
    }

    if (seconds < 3600) {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Создает callback_data для inline кнопки
   * @param {string} formatId - ID формата
   * @param {string} videoId - ID видео
   * @param {string} quality - качество (например, "1080p")
   * @returns {string} - callback_data в формате dl_{formatId}_{videoId}_{quality}
   */
  static createCallbackData(formatId, videoId, quality) {
    return `dl_${formatId}_${videoId}_${quality}`;
  }

  /**
   * Парсит callback_data из inline кнопки
   * @param {string} data - callback_data
   * @returns {Object|null} - объект с formatId, videoId, quality или null
   */
  static parseCallbackData(data) {
    if (!data || typeof data !== 'string' || !data.startsWith('dl_')) {
      return null;
    }

    // Формат: dl_formatId_videoId_quality
    // YouTube video ID всегда 11 символов
    // Убираем префикс "dl_"
    const withoutPrefix = data.substring(3);
    
    // Находим первый символ подчеркивания (после formatId)
    const firstUnderscore = withoutPrefix.indexOf('_');
    if (firstUnderscore === -1) {
      return null;
    }
    
    // videoId начинается после первого подчеркивания и имеет длину 11 символов
    const videoIdStart = firstUnderscore + 1;
    const videoIdEnd = videoIdStart + 11;
    
    // Проверяем, что после videoId есть подчеркивание
    if (videoIdEnd >= withoutPrefix.length || withoutPrefix[videoIdEnd] !== '_') {
      return null;
    }
    
    const formatId = withoutPrefix.substring(0, firstUnderscore);
    const videoId = withoutPrefix.substring(videoIdStart, videoIdEnd);
    const quality = withoutPrefix.substring(videoIdEnd + 1);

    return {
      formatId,
      videoId,
      quality
    };
  }
}

/**
 * RateLimiter - класс для ограничения частоты запросов
 */
class RateLimiter {
  /**
   * @param {number} maxRequests - максимальное количество запросов
   * @param {number} windowMs - временное окно в миллисекундах
   */
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map(); // userId -> массив timestamp'ов
  }

  /**
   * Проверяет, может ли пользователь сделать запрос
   * @param {number} userId - ID пользователя
   * @returns {boolean} - true если может сделать запрос
   */
  canMakeRequest(userId) {
    this.cleanup();
    
    const userRequests = this.requests.get(userId) || [];
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Фильтруем запросы в текущем окне
    const recentRequests = userRequests.filter(timestamp => timestamp > windowStart);
    
    return recentRequests.length < this.maxRequests;
  }

  /**
   * Регистрирует запрос от пользователя
   * @param {number} userId - ID пользователя
   */
  recordRequest(userId) {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    const windowStart = now - this.windowMs;
    
    // Фильтруем старые запросы и добавляем новый
    const recentRequests = userRequests.filter(timestamp => timestamp > windowStart);
    recentRequests.push(now);
    
    this.requests.set(userId, recentRequests);
  }

  /**
   * Получает время до сброса лимита в миллисекундах
   * @param {number} userId - ID пользователя
   * @returns {number} - время до сброса в миллисекундах
   */
  getTimeUntilReset(userId) {
    const userRequests = this.requests.get(userId);
    
    if (!userRequests || userRequests.length === 0) {
      return 0;
    }

    const now = Date.now();
    const oldestRequest = Math.min(...userRequests);
    const resetTime = oldestRequest + this.windowMs;
    
    return Math.max(0, resetTime - now);
  }

  /**
   * Очищает старые записи из кэша
   * @private
   */
  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    for (const [userId, timestamps] of this.requests.entries()) {
      const recentRequests = timestamps.filter(timestamp => timestamp > windowStart);
      
      if (recentRequests.length === 0) {
        this.requests.delete(userId);
      } else {
        this.requests.set(userId, recentRequests);
      }
    }
  }
}

/**
 * Logger - класс для логирования
 */
class Logger {
  /**
   * Логирует информационное сообщение
   * @param {string} message - сообщение для логирования
   * @param {object} metadata - дополнительные данные
   */
  static info(message, metadata = {}) {
    const formatted = this.format('INFO', message);
    console.log(formatted, metadata && Object.keys(metadata).length > 0 ? metadata : '');
  }

  /**
   * Логирует ошибку
   * @param {string} message - сообщение об ошибке
   * @param {Error} error - объект ошибки
   * @param {object} metadata - дополнительные данные
   */
  static error(message, error, metadata = {}) {
    const formatted = this.format('ERROR', message);
    console.error(formatted, error?.stack || error, metadata && Object.keys(metadata).length > 0 ? metadata : '');
  }

  /**
   * Логирует действие пользователя
   * @param {number} userId - ID пользователя
   * @param {string} username - имя пользователя
   * @param {string} action - действие
   * @param {object} details - детали действия
   */
  static userAction(userId, username, action, details = {}) {
    const message = `User ${userId} (@${username}) - ${action}`;
    const formatted = this.format('USER', message);
    console.log(formatted, details && Object.keys(details).length > 0 ? details : '');
  }

  /**
   * Форматирует лог сообщение
   * @private
   * @param {string} level - уровень логирования
   * @param {string} message - сообщение
   * @returns {string} - отформатированное сообщение
   */
  static format(level, message) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    return `[${timestamp}] ${level}: ${message}`;
  }
}

module.exports = {
  URLValidator,
  Formatter,
  RateLimiter,
  Logger
};
