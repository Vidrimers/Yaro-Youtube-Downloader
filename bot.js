const TelegramBot = require('node-telegram-bot-api');
const config = require('./config/config');
const VideoProcessor = require('./src/ytdlp');
const TelegramHelper = require('./src/telegram');
const { URLValidator, RateLimiter, Logger } = require('./src/utils');

/**
 * BotController - главный контроллер Telegram бота
 * Координирует все компоненты и обрабатывает события
 */
class BotController {
  /**
   * @param {string} token - Telegram Bot API токен
   * @param {Object} config - объект конфигурации
   */
  constructor(token, config) {
    this.token = token;
    this.config = config;
    
    // Инициализация компонентов
    this.bot = new TelegramBot(token, { polling: true });
    this.videoProcessor = new VideoProcessor();
    this.telegramHelper = new TelegramHelper(this.bot);
    this.rateLimiter = new RateLimiter(
      config.RATE_LIMIT_MAX_REQUESTS,
      config.RATE_LIMIT_WINDOW_MS
    );
    
    Logger.info('BotController initialized', {
      rateLimit: `${config.RATE_LIMIT_MAX_REQUESTS} requests per ${config.RATE_LIMIT_WINDOW_MS}ms`
    });
  }

  /**
   * Инициализация бота и регистрация обработчиков
   */
  initialize() {
    Logger.info('Registering bot handlers...');
    
    // Обработчик команд
    this.bot.onText(/^\/(.+)$/, (msg, match) => {
      const command = match[1].split(' ')[0];
      this.handleCommand(msg, command);
    });
    
    // Обработчик текстовых сообщений (не команд)
    this.bot.on('message', (msg) => {
      // Игнорируем команды (они обрабатываются отдельно)
      if (msg.text && !msg.text.startsWith('/')) {
        this.handleMessage(msg);
      }
    });
    
    // Обработчик callback queries (нажатия на inline кнопки)
    this.bot.on('callback_query', (query) => {
      this.handleCallbackQuery(query);
    });
    
    // Обработчик ошибок polling
    this.bot.on('polling_error', (error) => {
      Logger.error('Polling error', error);
    });
    
    Logger.info('Bot handlers registered successfully');
  }

  /**
   * Обработка команд бота
   * @param {Object} msg - объект сообщения Telegram
   * @param {string} command - команда без слэша
   */
  async handleCommand(msg, command) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || 'unknown';
    
    Logger.userAction(userId, username, `command: /${command}`);
    
    try {
      switch (command) {
        case 'start':
          await this.telegramHelper.sendWelcome(chatId);
          break;
          
        case 'help':
          await this.telegramHelper.sendHelp(chatId);
          break;
          
        default:
          // Игнорируем неизвестные команды
          Logger.info(`Unknown command: /${command}`, { userId, username });
          break;
      }
    } catch (error) {
      Logger.error(`Error handling command /${command}`, error, { userId, username });
      await this.telegramHelper.sendError(chatId, 'unknown');
    }
  }

  /**
   * Обработка текстовых сообщений с URL
   * @param {Object} msg - объект сообщения Telegram
   */
  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || 'unknown';
    const text = msg.text;
    
    Logger.userAction(userId, username, 'sent message', { text });
    
    try {
      // Проверка whitelist (если настроен)
      if (this.config.ALLOWED_USERS.length > 0) {
        if (!this.config.ALLOWED_USERS.includes(userId)) {
          Logger.info('User not in whitelist', { userId, username });
          await this.telegramHelper.sendError(chatId, 'unknown');
          return;
        }
      }
      
      // Валидация URL
      if (!URLValidator.isYouTubeUrl(text)) {
        Logger.info('Invalid YouTube URL', { userId, url: text });
        await this.telegramHelper.sendError(chatId, 'invalid_url');
        return;
      }
      
      // Проверка rate limit
      if (!this.rateLimiter.canMakeRequest(userId)) {
        const timeUntilReset = Math.ceil(this.rateLimiter.getTimeUntilReset(userId) / 1000);
        Logger.info('Rate limit exceeded', { userId, username, timeUntilReset });
        await this.telegramHelper.sendError(chatId, 'rate_limit_exceeded', timeUntilReset.toString());
        return;
      }
      
      // Регистрируем запрос
      this.rateLimiter.recordRequest(userId);
      
      // Нормализуем URL
      const normalizedUrl = URLValidator.normalizeUrl(text);
      Logger.info('Processing video', { userId, url: normalizedUrl });
      
      // Отправляем индикатор "печатает..."
      await this.bot.sendChatAction(chatId, 'typing');
      
      // Получаем информацию о видео
      const videoInfo = await this.videoProcessor.getVideoInfo(normalizedUrl);
      
      // Проверка длительности видео (если настроено)
      if (this.config.MAX_VIDEO_DURATION && videoInfo.duration > this.config.MAX_VIDEO_DURATION) {
        const maxMinutes = Math.floor(this.config.MAX_VIDEO_DURATION / 60);
        Logger.info('Video duration exceeded', { 
          userId, 
          duration: videoInfo.duration, 
          maxDuration: this.config.MAX_VIDEO_DURATION 
        });
        await this.telegramHelper.sendError(chatId, 'duration_exceeded', maxMinutes.toString());
        return;
      }
      
      // Получаем и фильтруем форматы
      const formats = this.videoProcessor.filterAndSortFormats(videoInfo.formats);
      
      if (formats.length === 0) {
        Logger.info('No suitable formats found', { userId, videoId: videoInfo.id });
        await this.telegramHelper.sendError(chatId, 'video_unavailable');
        return;
      }
      
      Logger.info('Formats found', { userId, videoId: videoInfo.id, formatsCount: formats.length });
      
      // Отправляем варианты качества
      await this.telegramHelper.sendVideoOptions(chatId, {
        ...videoInfo,
        formats
      });
      
    } catch (error) {
      Logger.error('Error handling message', error, { userId, username });
      
      // Определяем тип ошибки и отправляем соответствующее сообщение
      let errorType = 'unknown';
      
      if (error.message === 'TIMEOUT') {
        errorType = 'timeout';
      } else if (error.message === 'VIDEO_UNAVAILABLE') {
        errorType = 'video_unavailable';
      } else if (error.message === 'NETWORK_ERROR') {
        errorType = 'network_error';
      }
      
      await this.telegramHelper.sendError(chatId, errorType);
    }
  }

  /**
   * Обработка callback queries (нажатия на inline кнопки)
   * @param {Object} query - объект callback query
   */
  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const username = query.from.username || 'unknown';
    const callbackData = query.data;
    
    Logger.userAction(userId, username, 'callback query', { data: callbackData });
    
    try {
      // Парсим callback data
      const { Formatter } = require('./src/utils');
      const parsed = Formatter.parseCallbackData(callbackData);
      
      if (!parsed) {
        Logger.error('Invalid callback data', new Error('Parse failed'), { callbackData });
        await this.bot.answerCallbackQuery(query.id, { text: 'Ошибка обработки запроса' });
        return;
      }
      
      const { formatId, videoId, quality } = parsed;
      
      Logger.info('Getting direct URL', { userId, formatId, videoId, quality });
      
      // Отправляем индикатор "печатает..."
      await this.bot.sendChatAction(chatId, 'typing');
      
      // Получаем прямую ссылку
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const directUrl = await this.videoProcessor.getDirectUrl(url, formatId);
      
      Logger.info('Direct URL obtained', { userId, formatId, quality });
      
      // Отправляем прямую ссылку
      await this.telegramHelper.sendDirectLink(chatId, directUrl, quality);
      
      // Отвечаем на callback query (убирает индикатор загрузки на кнопке)
      await this.bot.answerCallbackQuery(query.id, { text: `Ссылка для ${quality} готова!` });
      
    } catch (error) {
      Logger.error('Error handling callback query', error, { userId, username, callbackData });
      
      // Определяем тип ошибки
      let errorType = 'unknown';
      let errorText = 'Произошла ошибка';
      
      if (error.message === 'TIMEOUT') {
        errorType = 'timeout';
        errorText = 'Превышено время ожидания';
      } else if (error.message === 'FORMAT_UNAVAILABLE') {
        errorType = 'format_unavailable';
        errorText = 'Формат недоступен';
      } else if (error.message === 'NETWORK_ERROR') {
        errorType = 'network_error';
        errorText = 'Ошибка сети';
      }
      
      await this.telegramHelper.sendError(chatId, errorType);
      await this.bot.answerCallbackQuery(query.id, { text: errorText });
    }
  }

  /**
   * Запуск бота
   */
  start() {
    Logger.info('Starting YouTube Downloader Bot...', {
      nodeEnv: this.config.NODE_ENV,
      allowedUsers: this.config.ALLOWED_USERS.length > 0 ? this.config.ALLOWED_USERS.length : 'all',
      maxVideoDuration: this.config.MAX_VIDEO_DURATION || 'unlimited'
    });
    
    this.initialize();
    
    Logger.info('Bot started successfully! Waiting for messages...');
  }
}

// Главная функция запуска
async function main() {
  try {
    // Загружаем конфигурацию
    config.load();
    config.validate();
    
    // Создаем и запускаем бота
    const botController = new BotController(config.TELEGRAM_BOT_TOKEN, config);
    botController.start();
    
  } catch (error) {
    Logger.error('Failed to start bot', error);
    process.exit(1);
  }
}

// Запускаем бота, если файл запущен напрямую
if (require.main === module) {
  main();
}

module.exports = BotController;
