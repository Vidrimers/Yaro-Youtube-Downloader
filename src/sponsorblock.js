const axios = require('axios');
const { Logger } = require('./utils');

/**
 * SponsorBlock - модуль для работы с SponsorBlock API
 * Получает информацию о спонсорских блоках в YouTube видео
 */
class SponsorBlock {
  constructor(apiUrl = 'https://sponsor.ajay.app', options = {}) {
    this.apiUrl = apiUrl;
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 10000;
    this.retryableErrors = [
      'ECONNRESET',
      'ENOTFOUND', 
      'ECONNREFUSED',
      'ETIMEDOUT',
      'Client network socket disconnected',
      'socket hang up',
      'network timeout'
    ];
  }

  /**
   * Проверяет, является ли ошибка повторяемой
   */
  isRetryableError(error) {
    if (!error) return false;
    
    const errorMessage = error.message || '';
    const errorCode = error.code || '';
    
    return this.retryableErrors.some(retryableError => 
      errorMessage.includes(retryableError) || errorCode === retryableError
    );
  }

  /**
   * Вычисляет задержку для retry с exponential backoff
   */
  calculateDelay(attempt) {
    const delay = this.baseDelay * Math.pow(2, attempt);
    return Math.min(delay, this.maxDelay);
  }

  /**
   * Выполняет HTTP запрос с retry механизмом
   */
  async executeWithRetry(requestFn, context = {}) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await requestFn();
        
        if (attempt > 0) {
          Logger.info('SponsorBlock request succeeded after retry', { 
            attempt, 
            ...context 
          });
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        // Если это последняя попытка или ошибка не повторяемая
        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          Logger.error(`SponsorBlock request failed after ${attempt + 1} attempts`, error, {
            isRetryable: this.isRetryableError(error),
            ...context
          });
          throw error;
        }
        
        // Логируем попытку retry
        const delay = this.calculateDelay(attempt);
        Logger.warn(`SponsorBlock request failed, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          maxRetries: this.maxRetries,
          error: error.message,
          ...context
        });
        
        // Ждем перед следующей попыткой
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Получить сегменты для видео
   * @param {string} videoId - ID YouTube видео
   * @param {string[]} categories - категории сегментов (по умолчанию все)
   * @returns {Promise<Array>} - массив сегментов
   */
  async getSegments(videoId, categories = null) {
    const params = {
      videoID: videoId
    };

    // Если категории не указаны, используем основные
    if (categories) {
      params.categories = JSON.stringify(categories);
    } else {
      // Основные категории для удаления
      params.categories = JSON.stringify([
        'sponsor',      // Спонсорская реклама
        'selfpromo',    // Самореклама
        'interaction',  // Призыв к действию (лайк/подписка)
        'intro',        // Интро/заставка
        'outro',        // Аутро/титры
        'preview',      // Превью/анонс
        'music_offtopic' // Музыка не по теме
      ]);
    }

    Logger.info('Fetching SponsorBlock segments', { videoId, categories: params.categories });

    try {
      const response = await this.executeWithRetry(
        () => axios.get(`${this.apiUrl}/api/skipSegments`, {
          params,
          timeout: 10000
        }),
        { videoId }
      );

      // Отладка: показываем что именно запросили
      Logger.info('SponsorBlock request URL', { 
        url: response.config.url,
        fullUrl: `${response.config.baseURL || ''}${response.config.url}?${new URLSearchParams(response.config.params).toString()}`
      });

      if (response.data && response.data.length > 0) {
        const segments = response.data; // SponsorBlock возвращает массив сегментов напрямую
        Logger.info('SponsorBlock segments found', { 
          videoId, 
          segmentsCount: segments.length 
        });
        return segments;
      }

      Logger.info('No SponsorBlock segments found', { videoId });
      return [];

    } catch (error) {
      // 404 означает что для видео нет данных - это нормально
      if (error.response && error.response.status === 404) {
        Logger.info('No SponsorBlock data for video', { videoId });
        return [];
      }

      Logger.error('Error fetching SponsorBlock segments', error, { 
        videoId,
        errorMessage: error.message 
      });
      return [];
    }
  }

  /**
   * Форматировать информацию о сегментах для отображения
   * @param {Array} segments - массив сегментов
   * @returns {Object} - отформатированная информация
   */
  formatSegmentsInfo(segments) {
    if (!segments || segments.length === 0) {
      return null;
    }

    const categoryNames = {
      sponsor: '📢 Спонсорская реклама',
      selfpromo: '📣 Самореклама',
      interaction: '👆 Призыв к действию',
      intro: '🎬 Интро',
      outro: '🎭 Аутро',
      preview: '👀 Превью',
      music_offtopic: '🎵 Музыка не по теме',
      poi_highlight: '⭐ Важный момент',
      filler: '💤 Заполнитель'
    };

    let totalDuration = 0;
    const segmentsList = [];

    segments.forEach(segment => {
      const [start, end] = segment.segment;
      const duration = end - start;
      totalDuration += duration;

      segmentsList.push({
        category: segment.category,
        categoryName: categoryNames[segment.category] || segment.category,
        start,
        end,
        duration,
        startFormatted: this.formatTime(start),
        endFormatted: this.formatTime(end),
        durationFormatted: this.formatTime(duration)
      });
    });

    return {
      segments: segmentsList,
      totalSegments: segments.length,
      totalDuration,
      totalDurationFormatted: this.formatTime(totalDuration)
    };
  }

  /**
   * Форматировать время в читаемый вид (MM:SS или HH:MM:SS)
   * @param {number} seconds - время в секундах
   * @returns {string} - отформатированное время
   */
  formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Создать текстовое описание сегментов
   * @param {Object} info - информация о сегментах из formatSegmentsInfo
   * @returns {string} - текстовое описание
   */
  createSegmentsDescription(info) {
    if (!info || !info.segments || info.segments.length === 0) {
      return null;
    }

    let description = `🎯 <b>Найдены рекламные блоки:</b>\n\n`;

    info.segments.forEach((seg, index) => {
      description += `${index + 1}. ${seg.categoryName}\n`;
      description += `   ${seg.startFormatted} - ${seg.endFormatted} (${seg.durationFormatted})\n\n`;
    });

    description += `📊 Всего: ${info.totalSegments} блоков, ${info.totalDurationFormatted} рекламы`;

    return description;
  }

  /**
   * Получить категории для отображения пользователю
   * @returns {Object} - объект с категориями
   */
  static getCategories() {
    return {
      sponsor: { name: 'Реклама', emoji: '📢', default: true },
      selfpromo: { name: 'Самореклама', emoji: '📣', default: true },
      interaction: { name: 'Призыв к действию', emoji: '👆', default: false },
      intro: { name: 'Интро', emoji: '🎬', default: false },
      outro: { name: 'Аутро', emoji: '🎭', default: false },
      preview: { name: 'Превью', emoji: '👀', default: false },
      music_offtopic: { name: 'Музыка не по теме', emoji: '🎵', default: false }
    };
  }

  /**
   * Получить группы категорий для быстрого выбора
   * @returns {Object} - объект с группами
   */
  static getCategoryGroups() {
    return {
      ads: {
        name: '📢 Реклама',
        categories: ['sponsor', 'selfpromo'],
        description: 'Убрать спонсорскую рекламу и самопродвижение'
      },
      intro_outro: {
        name: '🎬 Интро+Аутро', 
        categories: ['intro', 'outro'],
        description: 'Убрать заставки и титры'
      },
      interaction: {
        name: '👆 Призывы к действию',
        categories: ['interaction'],
        description: 'Убрать призывы лайкать и подписываться'
      },
      preview: {
        name: '👀 Превью',
        categories: ['preview'],
        description: 'Убрать анонсы и превью'
      },
      music_offtopic: {
        name: '🎵 Музыка не по теме',
        categories: ['music_offtopic'],
        description: 'Убрать музыку не относящуюся к теме'
      },
      all: {
        name: '🗑️ Убрать все блоки',
        categories: ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'music_offtopic'],
        description: 'Убрать все найденные блоки'
      }
    };
  }

  /**
   * Фильтровать сегменты по категориям
   * @param {Array} segments - все сегменты
   * @param {Array} categories - категории для включения
   * @returns {Array} - отфильтрованные сегменты
   */
  filterSegmentsByCategories(segments, categories) {
    if (!segments || !categories || categories.length === 0) {
      return [];
    }
    
    return segments.filter(segment => categories.includes(segment.category));
  }
}

module.exports = SponsorBlock;
