const { Formatter } = require('./utils');

/**
 * TelegramHelper - класс для работы с Telegram API и форматирования сообщений
 */
class TelegramHelper {
  /**
   * @param {TelegramBot} bot - экземпляр TelegramBot
   */
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * Создает inline клавиатуру из списка форматов
   * @param {Array} formats - массив форматов видео
   * @param {string} videoId - ID видео
   * @returns {Object} - объект inline клавиатуры
   */
  createQualityKeyboard(formats, videoId) {
    const buttons = formats.map(format => {
      const resolution = format.format_note || `${format.height}p`;
      const fileSize = Formatter.formatFileSize(format.filesize || 0);
      const ext = format.ext || 'mp4';
      
      // Формат кнопки: 🎬 1080p MP4 (150 MB)
      const buttonText = `🎬 ${resolution} ${ext.toUpperCase()} (${fileSize})`;
      const callbackData = Formatter.createCallbackData(format.format_id, videoId, resolution);
      
      return [{
        text: buttonText,
        callback_data: callbackData
      }];
    });

    return {
      inline_keyboard: buttons
    };
  }

  /**
   * Отправляет сообщение с вариантами качества видео
   * @param {number} chatId - ID чата
   * @param {Object} videoInfo - информация о видео
   * @returns {Promise<void>}
   */
  async sendVideoOptions(chatId, videoInfo) {
    const formats = videoInfo.formats || [];
    const keyboard = this.createQualityKeyboard(formats, videoInfo.id);
    
    const duration = Formatter.formatDuration(videoInfo.duration || 0);
    
    const message = `📹 *${this.escapeMarkdown(videoInfo.title)}*\n\n` +
                   `⏱ Длительность: ${duration}\n` +
                   `👤 Автор: ${this.escapeMarkdown(videoInfo.uploader || 'Неизвестно')}\n\n` +
                   `Выберите качество для скачивания:`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  /**
   * Отправляет прямую ссылку на скачивание
   * @param {number} chatId - ID чата
   * @param {string} url - прямая ссылка
   * @param {string} quality - выбранное качество
   * @returns {Promise<void>}
   */
  async sendDirectLink(chatId, url, quality) {
    const message = `✅ *Ссылка готова!*\n\n` +
                   `Качество: ${quality}\n\n` +
                   `🔗 [Нажмите для скачивания](${url})\n\n` +
                   `⚠️ Ссылка действительна ограниченное время (обычно несколько часов)`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  }

  /**
   * Отправляет сообщение об ошибке
   * @param {number} chatId - ID чата
   * @param {string} errorType - тип ошибки
   * @param {string} details - дополнительные детали
   * @returns {Promise<void>}
   */
  async sendError(chatId, errorType, details = '') {
    const errorMessages = {
      invalid_url: '❌ *Неверная ссылка*\n\nПожалуйста, отправьте корректную ссылку на YouTube видео.\n\n' +
                   'Примеры:\n' +
                   '• https://www.youtube.com/watch?v=VIDEO_ID\n' +
                   '• https://youtu.be/VIDEO_ID',
      
      video_unavailable: '❌ *Видео недоступно*\n\nВидео может быть:\n' +
                        '• Удалено\n' +
                        '• Приватное\n' +
                        '• Заблокировано в вашем регионе',
      
      timeout: '⏱ *Превышено время ожидания*\n\nСервер не ответил вовремя. Попробуйте позже.',
      
      network_error: '🌐 *Ошибка сети*\n\nПроблемы с подключением. Попробуйте позже.',
      
      format_unavailable: '❌ *Формат недоступен*\n\nВыбранный формат больше не доступен. Попробуйте другой.',
      
      rate_limit_exceeded: `⏳ *Слишком много запросов*\n\nПопробуйте через ${details} секунд.`,
      
      duration_exceeded: `⏱ *Видео слишком длинное*\n\nМаксимальная длительность: ${details} минут.`,
      
      unknown: '❌ *Произошла ошибка*\n\nПопробуйте позже или обратитесь к администратору.'
    };

    const message = errorMessages[errorType] || errorMessages.unknown;
    
    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  }

  /**
   * Отправляет приветственное сообщение
   * @param {number} chatId - ID чата
   * @returns {Promise<void>}
   */
  async sendWelcome(chatId) {
    const message = `👋 *Добро пожаловать!*\n\n` +
                   `Я помогу вам получить прямые ссылки на скачивание YouTube видео.\n\n` +
                   `*Как использовать:*\n` +
                   `1️⃣ Отправьте мне ссылку на YouTube видео\n` +
                   `2️⃣ Выберите нужное качество\n` +
                   `3️⃣ Получите прямую ссылку для скачивания\n\n` +
                   `Используйте /help для получения дополнительной информации.`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  }

  /**
   * Отправляет справку
   * @param {number} chatId - ID чата
   * @returns {Promise<void>}
   */
  async sendHelp(chatId) {
    const message = `📖 *Справка*\n\n` +
                   `*Поддерживаемые форматы ссылок:*\n` +
                   `• https://www.youtube.com/watch?v=VIDEO_ID\n` +
                   `• https://youtu.be/VIDEO_ID\n` +
                   `• https://m.youtube.com/watch?v=VIDEO_ID\n\n` +
                   `*Доступные качества:*\n` +
                   `• 1080p (Full HD)\n` +
                   `• 720p (HD)\n` +
                   `• 480p (SD)\n` +
                   `• 360p\n` +
                   `• 240p\n\n` +
                   `*Команды:*\n` +
                   `/start - Начать работу с ботом\n` +
                   `/help - Показать эту справку\n\n` +
                   `*Ограничения:*\n` +
                   `• Максимум 5 запросов в минуту\n` +
                   `• Ссылки действительны ограниченное время\n\n` +
                   `⚠️ *Важно:* Бот не скачивает и не хранит видео, а только предоставляет прямые ссылки.`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  }

  /**
   * Экранирует специальные символы Markdown
   * @private
   * @param {string} text - текст для экранирования
   * @returns {string} - экранированный текст
   */
  escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}

module.exports = TelegramHelper;
