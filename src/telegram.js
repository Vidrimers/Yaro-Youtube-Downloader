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
      
      // Добавляем индикатор если формат требует объединения
      const mergeIcon = format.needsMerge ? '🔄 ' : '';
      
      // Формат кнопки: 🎬 1080p MP4 (150 MB) или 🔄 🎬 1080p MP4 (150 MB)
      const buttonText = `${mergeIcon}🎬 ${resolution} ${ext.toUpperCase()} (${fileSize})`;
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
   * @param {Object} sponsorBlockInfo - информация о спонсорских блоках (опционально)
   * @returns {Promise<void>}
   */
  async sendVideoOptions(chatId, videoInfo, sponsorBlockInfo = null) {
    const formats = videoInfo.formats || [];
    const keyboard = this.createQualityKeyboard(formats, videoInfo.id);
    
    const duration = Formatter.formatDuration(videoInfo.duration || 0);
    
    let message = `📹 *${this.escapeMarkdown(videoInfo.title)}*\n\n` +
                  `⏱ Длительность: ${duration}\n` +
                  `👤 Автор: ${this.escapeMarkdown(videoInfo.uploader || 'Неизвестно')}\n\n`;
    
    // Добавляем информацию о спонсорских блоках если есть
    if (sponsorBlockInfo && sponsorBlockInfo.totalSegments > 0) {
      message += `🎯 Найдено рекламных блоков: ${sponsorBlockInfo.totalSegments} (${sponsorBlockInfo.totalDurationFormatted})\n\n`;
    }
    
    message += `Выберите качество для скачивания:`;

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
   * @param {string} formatId - ID формата
   * @param {string} videoUrl - оригинальная ссылка на видео
   * @returns {Promise<void>}
   */
  async sendDirectLink(chatId, url, quality, formatId, videoUrl) {
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
   * Отправляет видео файл в Telegram
   * @param {number} chatId - ID чата
   * @param {string} filePath - путь к видео файлу
   * @param {Object} videoInfo - информация о видео
   * @param {string} quality - качество видео
   * @param {number} uploadTimeout - timeout для загрузки (по умолчанию 10 минут)
   * @param {number} maxRetries - максимальное количество попыток (по умолчанию 2)
   * @returns {Promise<void>}
   */
  async sendVideoFile(chatId, filePath, videoInfo, quality, uploadTimeout = 600000, maxRetries = 2) {
    const caption = `📹 ${videoInfo.title}\n\n` +
                   `Качество: ${quality}\n` +
                   `⏱ Длительность: ${Formatter.formatDuration(videoInfo.duration || 0)}`;

    let lastError = null;
    
    // Пробуем загрузить файл с retry логикой
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.bot.sendVideo(chatId, filePath, {
          caption: caption,
          supports_streaming: true,
          parse_mode: 'Markdown',
          timeout: uploadTimeout,
          disable_notification: false
        });
        
        // Успешно загружено
        return;
        
      } catch (error) {
        lastError = error;
        
        // Если ошибка 413 (файл слишком большой), не пытаемся повторно
        if (error.message && error.message.includes('413')) {
          throw error;
        }
        
        // Если это последняя попытка, пробрасываем ошибку
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Логируем попытку и ждем перед следующей
        Logger.warn(`Upload attempt ${attempt} failed, retrying...`, { 
          chatId, 
          attempt, 
          error: error.message 
        });
        
        // Ждем перед следующей попыткой (экспоненциальная задержка)
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
    
    // Если дошли сюда, значит все попытки провалились
    throw lastError;
  }

  /**
   * Отправляет сообщение о процессе скачивания
   * @param {number} chatId - ID чата
   * @param {string} status - статус процесса
   * @returns {Promise<Object>} - отправленное сообщение
   */
  async sendDownloadStatus(chatId, status) {
    const statusMessages = {
      downloading: '⏬ Скачиваю видео...',
      downloading_audio: '🎵 Скачиваю аудио...',
      merging: '🔄 Объединяю видео и аудио...',
      uploading: '⏫ Загружаю в Telegram...',
      processing: '⚙️ Обрабатываю...'
    };

    const message = statusMessages[status] || statusMessages.processing;
    
    return await this.bot.sendMessage(chatId, message);
  }

  /**
   * Обновляет сообщение о статусе
   * @param {number} chatId - ID чата
   * @param {number} messageId - ID сообщения
   * @param {string} status - новый статус
   * @returns {Promise<void>}
   */
  async updateDownloadStatus(chatId, messageId, status) {
    const statusMessages = {
      downloading: '⏬ Скачиваю видео...',
      downloading_audio: '🎵 Скачиваю аудио...',
      merging: '🔄 Объединяю видео и аудио...',
      uploading: '⏫ Загружаю в Telegram...',
      processing: '⚙️ Обрабатываю...'
    };

    const message = statusMessages[status] || statusMessages.processing;
    
    try {
      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId
      });
    } catch (error) {
      // Игнорируем ошибки редактирования (например, если сообщение не изменилось)
    }
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
                   '• https://youtu.be/VIDEO_ID\n\n' +
                   '⚠️ Instagram — в разработке, пока недоступен.',
      
      video_unavailable: '❌ *Видео недоступно*\n\nВидео может быть:\n' +
                        '• Удалено\n' +
                        '• Приватное\n' +
                        '• Заблокировано в вашем регионе',
      
      timeout: '⏱ *Превышено время ожидания*\n\nСервер не ответил вовремя. Попробуйте позже.',
      
      network_error: '🌐 *Ошибка сети*\n\nПроблемы с подключением. Попробуйте позже.',
      
      format_unavailable: '❌ *Формат недоступен*\n\nВыбранный формат больше не доступен. Попробуйте другой.',
      
      file_too_large: '❌ *Файл слишком большой*\n\nРазмер файла превышает лимит Telegram (2GB).\nПопробуйте выбрать качество пониже.',
      
      merge_failed: '❌ *Ошибка объединения*\n\nНе удалось объединить видео и аудио.\nПопробуйте другой формат.',
      
      download_failed: '❌ *Ошибка скачивания*\n\nНе удалось скачать видео.\nПопробуйте позже.',
      
      rate_limit_exceeded: `⏳ *Слишком много запросов*\n\nПопробуйте через ${details} секунд.`,
      
      duration_exceeded: `⏱ *Видео слишком длинное*\n\nМаксимальная длительность: ${details} минут.`,
      
      unknown: '❌ *Произошла ошибка*\n\nПопробуйте позже или обратитесь к администратору.'
    };

    const message = errorMessages[errorType] || errorMessages.unknown;

    // Для unknown ошибки добавляем кнопку "Написать администратору"
    const options = { parse_mode: 'Markdown' };
    if (!errorMessages[errorType] || errorType === 'unknown') {
      options.reply_markup = {
        inline_keyboard: [[
          { text: '✍️ Написать администратору', callback_data: 'contact_admin' }
        ]]
      };
    }

    await this.bot.sendMessage(chatId, message, options);
  }

  /**
   * Отправляет приветственное сообщение
   * @param {number} chatId - ID чата
   * @returns {Promise<void>}
   */
  async sendWelcome(chatId) {
    const message = `👋 <b>Добро пожаловать!</b>\n\n` +
                   `Я помогу вам скачать YouTube видео с возможностью удаления рекламы.\n\n` +
                   `<b>Как использовать:</b>\n` +
                   `1️⃣ Отправьте мне ссылку на YouTube видео\n` +
                   `2️⃣ Выберите нужное качество\n` +
                   `3️⃣ Выберите что удалить из видео (реклама, интро и т.д.)\n` +
                   `4️⃣ Получите готовое видео в Telegram или по ссылке\n\n` +
                   `⚠️ <b>Instagram</b> — в разработке, скоро будет доступен.\n\n` +
                   `Используйте /help для получения дополнительной информации.`;

    const keyboard = {
      inline_keyboard: [
        [
          { 
            text: '💝 Донатная', 
            callback_data: 'donate_menu' 
          }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  /**
   * Отправляет справку
   * @param {number} chatId - ID чата
   * @returns {Promise<void>}
   */
  async sendHelp(chatId) {
    const message = `📖 <b>Справка</b>\n\n` +
                   `<b>Поддерживаемые форматы ссылок:</b>\n` +
                   `YouTube:\n` +
                   `• https://www.youtube.com/watch?v=VIDEO_ID\n` +
                   `• https://youtu.be/VIDEO_ID\n\n` +
                   `⚠️ <b>Instagram</b> — в разработке, скоро будет доступен.\n\n` +
                   `<b>Доступные качества:</b>\n` +
                   `• 1080p (Full HD)\n` +
                   `• 720p (HD)\n` +
                   `• 480p (SD)\n` +
                   `• 360p\n` +
                   `• 240p\n\n` +
                   `<b>Функции:</b>\n` +
                   `🎯 Автоматическое обнаружение рекламных блоков\n` +
                   `✂️ Удаление рекламы по категориям:\n` +
                   `   • 📢 Реклама и самопродвижение\n` +
                   `   • 🎬 Интро и аутро\n` +
                   `   • 👆 Призывы к действию\n` +
                   `   • 👀 Превью и анонсы\n` +
                   `   • 🎵 Музыка не по теме\n` +
                   `📥 Скачивание видео в Telegram или через файловый сервер\n\n` +
                   `<b>Команды:</b>\n` +
                   `/start - Начать работу с ботом\n` +
                   `/help - Показать эту справку\n\n` +
                   `<b>Ограничения:</b>\n` +
                   `• Максимум 5 запросов в минуту\n` +
                   `• Файлы до 100MB отправляются в Telegram\n` +
                   `• Большие файлы доступны через временные ссылки\n\n` +
                   `⚠️ <b>Важно:</b> Бот скачивает и обрабатывает видео для удаления рекламы. Файлы автоматически удаляются после отправки.`;

    const keyboard = {
      inline_keyboard: [
        [
          { 
            text: '💝 Донатная', 
            callback_data: 'donate_menu' 
          }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  /**
   * Отправляет меню донатов
   * @param {number} chatId - ID чата
   * @param {number} userId - ID пользователя (для проверки админа)
   * @returns {Promise<void>}
   */
  async sendDonateMenu(chatId, userId = null) {
    const message = `💝 <b>Поддержать проект</b>\n\n` +
                   `Если вам нравится бот и вы хотите поддержать его развитие, вы можете сделать донат.\n\n` +
                   `Ваша поддержка поможет:\n` +
                   `• Оплачивать серверы для обработки видео\n` +
                   `• Добавлять новые функции\n` +
                   `• Поддерживать стабильную работу\n\n` +
                   `Выберите удобный способ доната:`;

    const config = require('../config/config');
    const keyboard = { inline_keyboard: [] };

    // DonationAlerts (всегда первый)
    if (config.DONATION_ALERTS_URL) {
      keyboard.inline_keyboard.push([{
        text: '🎁 DonationAlerts',
        url: config.DONATION_ALERTS_URL
      }]);
    }

    // Криптовалютные кнопки
    const cryptoButtons = [];
    
    if (config.KASPA_ADDRESS) {
      cryptoButtons.push({
        text: '💎 Kaspa',
        callback_data: 'donate_kaspa'
      });
    }
    
    if (config.TON_ADDRESS) {
      cryptoButtons.push({
        text: '💠 TON',
        callback_data: 'donate_ton'
      });
    }
    
    if (config.USDT_ADDRESS) {
      cryptoButtons.push({
        text: '💵 USDT (TRC-20)',
        callback_data: 'donate_usdt'
      });
    }

    // Добавляем криптовалютные кнопки (по 2 в ряд)
    for (let i = 0; i < cryptoButtons.length; i += 2) {
      const row = cryptoButtons.slice(i, i + 2);
      keyboard.inline_keyboard.push(row);
    }

    // Админская кнопка (только для админа)
    if (config.TELEGRAM_ADMIN_ID && userId === config.TELEGRAM_ADMIN_ID) {
      keyboard.inline_keyboard.push([{
        text: '📊 Баланс кошельков',
        callback_data: 'admin_balance'
      }]);
    }

    // Кнопка "Назад"
    keyboard.inline_keyboard.push([{
      text: '◀️ Назад',
      callback_data: 'back_to_main'
    }]);

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
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

  /**
   * Отправляет адрес Kaspa кошелька
   * @param {number} chatId - ID чата
   * @returns {Promise<void>}
   */
  async sendKaspaAddress(chatId) {
    const config = require('../config/config');
    
    if (!config.KASPA_ADDRESS) {
      await this.bot.sendMessage(chatId, '❌ Kaspa адрес не настроен', {
        reply_markup: {
          inline_keyboard: [[
            { text: '◀️ Назад', callback_data: 'donate_menu' }
          ]]
        }
      });
      return;
    }

    const message = `💎 <b>Kaspa (KAS)</b>\n\n` +
                   `Адрес кошелька:\n` +
                   `<code>${config.KASPA_ADDRESS}</code>\n\n` +
                   `📋 Нажмите на адрес, чтобы скопировать\n\n` +
                   `ℹ️ Kaspa - это быстрая и масштабируемая криптовалюта с мгновенными транзакциями`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Назад к донатам', callback_data: 'donate_menu' }]
        ]
      }
    });
  }

  /**
   * Отправляет адрес TON кошелька
   * @param {number} chatId - ID чата
   * @returns {Promise<void>}
   */
  async sendTonAddress(chatId) {
    const config = require('../config/config');
    
    if (!config.TON_ADDRESS) {
      await this.bot.sendMessage(chatId, '❌ TON адрес не настроен', {
        reply_markup: {
          inline_keyboard: [[
            { text: '◀️ Назад', callback_data: 'donate_menu' }
          ]]
        }
      });
      return;
    }

    const message = `💠 <b>TON (Toncoin)</b>\n\n` +
                   `Адрес кошелька:\n` +
                   `<code>${config.TON_ADDRESS}</code>\n\n` +
                   `📋 Нажмите на адрес, чтобы скопировать\n\n` +
                   `ℹ️ TON - это блокчейн от создателей Telegram с низкими комиссиями`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Назад к донатам', callback_data: 'donate_menu' }]
        ]
      }
    });
  }

  /**
   * Отправляет адрес USDT кошелька
   * @param {number} chatId - ID чата
   * @returns {Promise<void>}
   */
  async sendUsdtAddress(chatId) {
    const config = require('../config/config');
    
    if (!config.USDT_ADDRESS) {
      await this.bot.sendMessage(chatId, '❌ USDT адрес не настроен', {
        reply_markup: {
          inline_keyboard: [[
            { text: '◀️ Назад', callback_data: 'donate_menu' }
          ]]
        }
      });
      return;
    }

    const message = `💵 <b>USDT (TRC-20)</b>\n\n` +
                   `Адрес кошелька:\n` +
                   `<code>${config.USDT_ADDRESS}</code>\n\n` +
                   `📋 Нажмите на адрес, чтобы скопировать\n\n` +
                   `⚠️ <b>Важно:</b> Используйте только сеть TRON (TRC-20)!\n` +
                   `Отправка через другие сети приведет к потере средств.`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Назад к донатам', callback_data: 'donate_menu' }]
        ]
      }
    });
  }

  /**
   * Отправляет выбор: скачать с рекламой или без
   * @param {number} chatId - ID чата
   * @param {string} videoId - ID видео
   * @param {string} formatId - ID формата
   * @param {string} quality - качество видео
   * @param {Object} sponsorBlockInfo - информация о спонсорских блоках
   * @returns {Promise<void>}
   */
  async sendSponsorBlockChoice(chatId, videoId, formatId, quality, sponsorBlockInfo) {
    const message = sponsorBlockInfo.description + '\n\n' +
                   '❓ Как скачать видео?';

    // Получаем доступные категории из найденных сегментов
    const availableCategories = [...new Set(sponsorBlockInfo.segments.map(s => s.category))];
    const SponsorBlock = require('./sponsorblock');
    const categoryGroups = SponsorBlock.getCategoryGroups();
    
    // Создаем кнопки для групп категорий, которые есть в видео
    const keyboard = { inline_keyboard: [] };
    
    // Добавляем группы категорий, если они есть в видео
    Object.entries(categoryGroups).forEach(([groupKey, group]) => {
      const hasCategories = group.categories.some(cat => availableCategories.includes(cat));
      if (hasCategories && groupKey !== 'all') { // 'all' добавим отдельно
        keyboard.inline_keyboard.push([{
          text: group.name,
          callback_data: `sb_group_${groupKey}_${formatId}_${videoId}_${quality}`
        }]);
      }
    });
    
    // Добавляем "Убрать все блоки" если есть хотя бы один сегмент
    if (availableCategories.length > 0) {
      keyboard.inline_keyboard.push([{
        text: categoryGroups.all.name,
        callback_data: `sb_group_all_${formatId}_${videoId}_${quality}`
      }]);
    }
    
    // Добавляем "Скачать как есть"
    keyboard.inline_keyboard.push([{
      text: '📥 Скачать как есть',
      callback_data: `sb_keep_${formatId}_${videoId}_${quality}`
    }]);

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }
}

module.exports = TelegramHelper;
