const axios = require('axios');
const { Logger } = require('./utils');

/**
 * SponsorBlock - модуль для работы с SponsorBlock API
 * Получает информацию о спонсорских блоках в YouTube видео
 */
class SponsorBlock {
  constructor(apiUrl = 'https://sponsor.ajay.app') {
    this.apiUrl = apiUrl;
  }

  /**
   * Получить сегменты для видео
   * @param {string} videoId - ID YouTube видео
   * @param {string[]} categories - категории сегментов (по умолчанию все)
   * @returns {Promise<Array>} - массив сегментов
   */
  async getSegments(videoId, categories = null) {
    try {
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

      const response = await axios.get(`${this.apiUrl}/api/skipSegments`, {
        params,
        timeout: 10000
      });

      // Отладка: показываем что именно запросили
      Logger.info('SponsorBlock request URL', { 
        url: response.config.url,
        fullUrl: `${response.config.baseURL || ''}${response.config.url}?${new URLSearchParams(response.config.params).toString()}`
      });

      if (response.data && response.data.length > 0) {
        const segments = response.data[0].segments || [];
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
      sponsor: { name: 'Спонсорская реклама', emoji: '📢', default: true },
      selfpromo: { name: 'Самореклама', emoji: '📣', default: true },
      interaction: { name: 'Призыв к действию', emoji: '👆', default: true },
      intro: { name: 'Интро', emoji: '🎬', default: false },
      outro: { name: 'Аутро', emoji: '🎭', default: false },
      preview: { name: 'Превью', emoji: '👀', default: true },
      music_offtopic: { name: 'Музыка не по теме', emoji: '🎵', default: false }
    };
  }
}

module.exports = SponsorBlock;
