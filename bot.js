const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const config = require('./config/config');
const VideoProcessor = require('./src/ytdlp');
const TelegramHelper = require('./src/telegram');
const FileManager = require('./src/fileManager');
const FileServer = require('./src/fileServer');
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
    this.fileManager = new FileManager(config.TEMP_DIR, config.MERGE_TIMEOUT);
    this.rateLimiter = new RateLimiter(
      config.RATE_LIMIT_MAX_REQUESTS,
      config.RATE_LIMIT_WINDOW_MS
    );
    
    // Инициализируем файловый сервер для больших файлов
    this.fileServer = new FileServer(
      config.FILE_SERVER_PORT, 
      config.FILE_SERVER_BASE_URL
    );
    
    Logger.info('BotController initialized', {
      rateLimit: `${config.RATE_LIMIT_MAX_REQUESTS} requests per ${config.RATE_LIMIT_WINDOW_MS}ms`,
      tempDir: config.TEMP_DIR
    });
  }

  /**
   * Инициализация бота и регистрация обработчиков
   */
  async initialize() {
    Logger.info('Registering bot handlers...');
    
    // Инициализируем FileManager
    await this.fileManager.initialize();
    
    // Запускаем файловый сервер
    try {
      await this.fileServer.start();
    } catch (error) {
      Logger.error('Failed to start file server', error);
      throw error;
    }
    
    // Проверяем доступность ffmpeg
    const ffmpegAvailable = await this.fileManager.checkFfmpegAvailable();
    if (ffmpegAvailable) {
      Logger.info('ffmpeg is available');
    } else {
      Logger.warn('ffmpeg is not available - video merging will not work');
    }
    
    // Запускаем периодическую очистку старых файлов
    this.startCleanupInterval();
    
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
   * Запускает интервал для очистки старых файлов
   */
  startCleanupInterval() {
    setInterval(() => {
      this.fileManager.cleanupOldFiles(this.config.FILE_MAX_AGE);
    }, this.config.CLEANUP_INTERVAL);
    
    Logger.info('Cleanup interval started', {
      interval: this.config.CLEANUP_INTERVAL,
      maxAge: this.config.FILE_MAX_AGE
    });
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
          Logger.info('Access denied: User not in whitelist', { 
            userId, 
            username,
            allowedUsers: this.config.ALLOWED_USERS,
            attemptedUrl: text
          });
          await this.bot.sendMessage(
            chatId, 
            '❌ Доступ запрещен. Этот бот доступен только авторизованным пользователям.'
          );
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
      if (!videoInfo || !videoInfo.formats) {
        Logger.error('Video info or formats not available', null, { userId, videoInfo });
        await this.telegramHelper.sendError(chatId, 'video_unavailable');
        return;
      }
      
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
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      
      Logger.info('Processing format request', { userId, formatId, videoId, quality });
      
      // Получаем информацию о видео и ВСЕ форматы (не фильтрованные)
      const videoInfo = await this.videoProcessor.getVideoInfo(url);
      
      if (!videoInfo || !videoInfo.formats) {
        Logger.error('Video info or formats not available in callback', null, { userId, videoId });
        await this.telegramHelper.sendError(chatId, 'video_unavailable');
        await this.bot.answerCallbackQuery(query.id, { text: 'Видео недоступно' });
        return;
      }
      
      const format = videoInfo.formats.find(f => f.format_id === formatId);
      
      if (!format) {
        Logger.error('Format not found', new Error('Format not found'), { 
          formatId, 
          videoId,
          availableFormats: videoInfo.formats.map(f => f.format_id).join(', ')
        });
        await this.telegramHelper.sendError(chatId, 'format_unavailable');
        await this.bot.answerCallbackQuery(query.id, { text: 'Формат не найден' });
        return;
      }
      
      // Проверяем, является ли формат комбинированным
      const isCombined = this.videoProcessor.isCombinedFormat(format);
      
      // Проверяем, нужно ли объединять видео и аудио
      if (!isCombined) {
        // Формат раздельный - нужно скачать и объединить
        // ВАЖНО: отвечаем на callback query СРАЗУ, до начала скачивания
        await this.bot.answerCallbackQuery(query.id, { text: 'Начинаю скачивание...' });
        await this.handleMergedDownload(chatId, userId, url, videoInfo, format, quality);
      } else {
        // Обычная прямая ссылка
        await this.bot.sendChatAction(chatId, 'typing');
        const directUrl = await this.videoProcessor.getDirectUrl(url, formatId);
        await this.telegramHelper.sendDirectLink(chatId, directUrl, quality, formatId, url);
        await this.bot.answerCallbackQuery(query.id, { text: `Ссылка для ${quality} готова!` });
      }
      
    } catch (error) {
      Logger.error('Error handling callback query', error, { userId, username, callbackData });
      
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
      } else if (error.message === 'FILE_TOO_LARGE') {
        errorType = 'file_too_large';
        errorText = 'Файл слишком большой';
      } else if (error.message === 'MERGE_FAILED') {
        errorType = 'merge_failed';
        errorText = 'Ошибка объединения';
      } else if (error.message === 'AUDIO_FORMAT_NOT_FOUND') {
        errorType = 'format_unavailable';
        errorText = 'Аудио формат не найден';
      } else if (error.message === 'DOWNLOAD_FAILED') {
        errorType = 'download_failed';
        errorText = 'Ошибка скачивания';
      } else if (error.message === 'UPLOAD_FAILED') {
        errorType = 'unknown';
        errorText = 'Ошибка загрузки файла';
      } else if (error.message === 'VIDEO_FORMAT_NOT_FOUND') {
        errorType = 'format_unavailable';
        errorText = 'Видео формат недоступен';
      }
      
      await this.telegramHelper.sendError(chatId, errorType);
      
      // Пытаемся ответить на callback query, но игнорируем ошибку если он уже устарел
      try {
        await this.bot.answerCallbackQuery(query.id, { text: errorText });
      } catch (callbackError) {
        // Игнорируем ошибку - callback query мог устареть
        Logger.info('Failed to answer callback query (probably expired)', { userId });
      }
    }
  }

  /**
   * Обрабатывает скачивание с объединением видео и аудио
   * @param {number} chatId - ID чата
   * @param {number} userId - ID пользователя
   * @param {string} url - URL видео
   * @param {Object} videoInfo - информация о видео
   * @param {Object} format - выбранный формат
   * @param {string} quality - качество
   */
  async handleMergedDownload(chatId, userId, url, videoInfo, format, quality) {
    let statusMessage = null;
    let videoPath = null;
    let audioPath = null;
    let outputPath = null;
    let fileUsedByServer = false; // Флаг: файл используется сервером, не удалять
    
    try {
      // Отправляем статус
      statusMessage = await this.telegramHelper.sendDownloadStatus(chatId, 'downloading');
      
      // Генерируем пути для файлов
      videoPath = this.fileManager.generateFilePath(videoInfo.id, 'video.mp4');
      audioPath = this.fileManager.generateFilePath(videoInfo.id, 'audio.m4a');
      outputPath = this.fileManager.generateFilePath(videoInfo.id, 'mp4');
      
      // Скачиваем видео поток с fallback на другие форматы того же разрешения
      Logger.info('Downloading video stream', { userId, formatId: format.format_id });
      
      let videoDownloaded = false;
      let lastVideoError = null;
      
      // Получаем все видео форматы того же разрешения для fallback
      const targetHeight = format.height;
      const sameResolutionFormats = videoInfo.formats.filter(f =>
        f.vcodec && f.vcodec !== 'none' &&
        (!f.acodec || f.acodec === 'none') &&
        f.height === targetHeight
      ).sort((a, b) => {
        // Приоритет: mp4 > webm, меньший битрейт лучше для скорости
        const codecPriorityA = a.ext === 'mp4' ? 0 : 1;
        const codecPriorityB = b.ext === 'mp4' ? 0 : 1;
        if (codecPriorityA !== codecPriorityB) {
          return codecPriorityA - codecPriorityB;
        }
        return (a.tbr || 0) - (b.tbr || 0);
      });
      
      // Начинаем с выбранного формата, потом пробуем остальные
      const formatsToTry = [format, ...sameResolutionFormats.filter(f => f.format_id !== format.format_id)];
      
      for (const videoFmt of formatsToTry) {
        try {
          await this.videoProcessor.downloadStream(url, videoFmt.format_id, videoPath, this.config.DOWNLOAD_TIMEOUT);
          Logger.info('Video downloaded successfully', { userId, formatId: videoFmt.format_id });
          videoDownloaded = true;
          break;
        } catch (videoError) {
          Logger.warn('Video format failed, trying next', { 
            userId, 
            formatId: videoFmt.format_id, 
            error: videoError.message 
          });
          lastVideoError = videoError;
          continue;
        }
      }
      
      if (!videoDownloaded) {
        Logger.error('All video formats failed', lastVideoError, { userId });
        throw new Error('VIDEO_FORMAT_NOT_FOUND');
      }
      
      // Обновляем статус
      await this.telegramHelper.updateDownloadStatus(chatId, statusMessage.message_id, 'downloading_audio');
      
      // Получаем лучший аудио формат
      const audioFormat = this.videoProcessor.getBestAudioFormat(videoInfo.formats);
      if (!audioFormat) {
        throw new Error('AUDIO_FORMAT_NOT_FOUND');
      }
      
      // Скачиваем аудио поток с fallback на другие форматы
      Logger.info('Downloading audio stream', { userId, formatId: audioFormat.format_id });
      
      let audioDownloaded = false;
      let lastAudioError = null;
      
      // Получаем все доступные аудио форматы для fallback
      const allAudioFormats = videoInfo.formats.filter(f => 
        f.acodec && f.acodec !== 'none' && 
        (!f.vcodec || f.vcodec === 'none')
      ).sort((a, b) => (b.abr || 0) - (a.abr || 0)); // Сортируем по качеству
      
      for (const audioFmt of allAudioFormats) {
        try {
          await this.videoProcessor.downloadStream(url, audioFmt.format_id, audioPath, this.config.DOWNLOAD_TIMEOUT);
          Logger.info('Audio downloaded successfully', { userId, formatId: audioFmt.format_id });
          audioDownloaded = true;
          break;
        } catch (audioError) {
          Logger.warn('Audio format failed, trying next', { 
            userId, 
            formatId: audioFmt.format_id, 
            error: audioError.message 
          });
          lastAudioError = audioError;
          continue;
        }
      }
      
      if (!audioDownloaded) {
        Logger.error('All audio formats failed', lastAudioError, { userId });
        throw new Error('AUDIO_FORMAT_NOT_FOUND');
      }
      
      // Обновляем статус
      await this.telegramHelper.updateDownloadStatus(chatId, statusMessage.message_id, 'merging');
      
      // Объединяем видео и аудио
      Logger.info('Merging video and audio', { userId, videoId: videoInfo.id });
      await this.fileManager.mergeVideoAudio(videoPath, audioPath, outputPath);
      
      // Проверяем размер файла и выбираем стратегию отправки
      const fileSize = await this.fileManager.getFileSize(outputPath);
      Logger.info('File merged', { userId, fileSize });
      
      // Лимиты для разных стратегий отправки
      const TELEGRAM_STABLE_LIMIT = 104857600; // 100MB - стабильная отправка
      const TELEGRAM_TRY_LIMIT = this.config.TELEGRAM_UPLOAD_LIMIT; // 500MB - пытаемся отправить
      
      if (fileSize <= TELEGRAM_STABLE_LIMIT) {
        // Файл < 100MB - отправляем в Telegram как обычно
        Logger.info('File size is within stable limit, sending to Telegram', { userId, fileSize });
        
        await this.telegramHelper.updateDownloadStatus(chatId, statusMessage.message_id, 'uploading');
        await this.bot.deleteMessage(chatId, statusMessage.message_id);
        await this.bot.sendChatAction(chatId, 'upload_video');
        
        const uploadStartTime = Date.now();
        await this.telegramHelper.sendVideoFile(chatId, outputPath, videoInfo, quality, this.config.TELEGRAM_UPLOAD_TIMEOUT);
        const uploadDuration = Date.now() - uploadStartTime;
        
        Logger.info('Video uploaded successfully', { userId, videoId: videoInfo.id, fileSize, uploadDuration });
        
      } else if (fileSize <= TELEGRAM_TRY_LIMIT) {
        // Файл 100-500MB - пытаемся отправить в Telegram, при неудаче создаем ссылку на сервер
        Logger.info('File size is large, trying Telegram upload with server fallback', { 
          userId, 
          fileSize, 
          stableLimit: TELEGRAM_STABLE_LIMIT,
          tryLimit: TELEGRAM_TRY_LIMIT 
        });
        
        try {
          await this.telegramHelper.updateDownloadStatus(chatId, statusMessage.message_id, 'uploading');
          await this.bot.deleteMessage(chatId, statusMessage.message_id);
          await this.bot.sendChatAction(chatId, 'upload_video');
          
          const uploadStartTime = Date.now();
          await this.telegramHelper.sendVideoFile(chatId, outputPath, videoInfo, quality, this.config.TELEGRAM_UPLOAD_TIMEOUT);
          const uploadDuration = Date.now() - uploadStartTime;
          
          Logger.info('Large video uploaded successfully to Telegram', { userId, videoId: videoInfo.id, fileSize, uploadDuration });
          
        } catch (uploadError) {
          Logger.warn('Telegram upload failed, creating server link', { 
            userId, 
            fileSize,
            error: uploadError.message,
            errorCode: uploadError.response?.statusCode || 'unknown'
          });
          
          // Создаем временную ссылку на сервер
          const linkInfo = this.fileServer.createTemporaryLink(
            path.resolve(outputPath), 
            `${videoInfo.title || videoInfo.id}.mp4`,
            this.config.LARGE_FILE_TTL_MINUTES
          );
          
          // Отправляем ссылку пользователю
          const expiresAt = new Date(linkInfo.expiresAt).toLocaleString('ru-RU');
          await this.bot.sendMessage(chatId, 
            `📁 <b>Файл готов для скачивания!</b>\n\n` +
            `📊 Размер: ${this.formatFileSize(fileSize)}\n` +
            `⏰ Ссылка действует до: ${expiresAt}\n\n` +
            `🔗 <a href="${linkInfo.downloadUrl}">Скачать файл</a>`,
            { parse_mode: 'HTML' }
          );
          
          Logger.info('Server download link sent', { userId, fileId: linkInfo.fileId });
          
          // Помечаем, что файл используется сервером
          fileUsedByServer = true;
          
          // Удаляем только временные файлы (video и audio), но не outputPath
          await this.fileManager.deleteFiles([videoPath, audioPath].filter(Boolean));
          return;
        }
        
      } else {
        // Файл > 500MB - сразу создаем ссылку на сервер
        Logger.info('File is very large, creating server link immediately', { 
          userId, 
          fileSize, 
          limit: TELEGRAM_TRY_LIMIT 
        });
        
        // Создаем временную ссылку на сервер
        const linkInfo = this.fileServer.createTemporaryLink(
          path.resolve(outputPath), 
          `${videoInfo.title || videoInfo.id}.mp4`,
          this.config.LARGE_FILE_TTL_MINUTES
        );
        
        // Удаляем статусное сообщение
        try {
          await this.bot.deleteMessage(chatId, statusMessage.message_id);
        } catch (deleteError) {
          Logger.info('Could not delete status message', { userId });
        }
        
        // Отправляем ссылку пользователю
        const expiresAt = new Date(linkInfo.expiresAt).toLocaleString('ru-RU');
        await this.bot.sendMessage(chatId, 
          `📁 <b>Файл готов для скачивания!</b>\n\n` +
          `📊 Размер: ${this.formatFileSize(fileSize)}\n` +
          `⏰ Ссылка действует до: ${expiresAt}\n\n` +
          `🔗 <a href="${linkInfo.downloadUrl}">Скачать файл</a>\n\n` +
          `ℹ️ Файл слишком большой для отправки в Telegram, поэтому создана временная ссылка на сервер.`,
          { parse_mode: 'HTML' }
        );
        
        Logger.info('Server download link sent for very large file', { userId, fileId: linkInfo.fileId });
        
        // Помечаем, что файл используется сервером
        fileUsedByServer = true;
        
        // Удаляем только временные файлы (video и audio), но не outputPath
        await this.fileManager.deleteFiles([videoPath, audioPath].filter(Boolean));
        return;
      }
      
    } catch (error) {
      Logger.error('Error in merged download', error, { 
        userId,
        errorMessage: error.message,
        stderr: error.stderr || 'no stderr',
        stack: error.stack
      });
      
      // Удаляем статусное сообщение если оно есть
      if (statusMessage) {
        try {
          await this.bot.deleteMessage(chatId, statusMessage.message_id);
        } catch (deleteError) {
          Logger.info('Could not delete status message', { userId });
        }
      }
      
      // Обработка специфических ошибок
      if (error.message === 'VIDEO_FORMAT_NOT_FOUND' || error.message === 'AUDIO_FORMAT_NOT_FOUND') {
        Logger.info('Format not available, trying fallback to combined format', { userId });
        
        try {
          // Пытаемся найти комбинированный формат того же разрешения
          const targetHeight = format.height;
          const combinedFormats = videoInfo.formats.filter(f =>
            f.vcodec && f.vcodec !== 'none' &&
            f.acodec && f.acodec !== 'none' &&
            f.height === targetHeight
          ).sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
          
          if (combinedFormats.length > 0) {
            Logger.info('Found combined format, trying direct download', { 
              userId, 
              formatId: combinedFormats[0].format_id 
            });
            
            // Пытаемся скачать комбинированный формат
            const combinedOutputPath = this.fileManager.generateFilePath(videoInfo.id, 'mp4');
            await this.videoProcessor.downloadVideo(url, combinedFormats[0].format_id, combinedOutputPath, this.config.DOWNLOAD_TIMEOUT);
            
            const fileSize = await this.fileManager.getFileSize(combinedOutputPath);
            
            // Проверяем размер и отправляем
            if (fileSize > this.config.MAX_FILE_SIZE) {
              await this.fileManager.deleteFiles([combinedOutputPath]);
              throw new Error('FILE_TOO_LARGE');
            }
            
            await this.telegramHelper.sendVideoFile(chatId, combinedOutputPath, videoInfo, quality, this.config.TELEGRAM_UPLOAD_TIMEOUT);
            await this.fileManager.deleteFiles([combinedOutputPath]);
            
            Logger.info('Successfully sent video using combined format fallback', { userId });
            return;
          } else {
            // Если нет комбинированных форматов, пытаемся отправить прямую ссылку
            Logger.info('No combined formats available, trying direct URL', { userId });
            
            const directUrl = await this.videoProcessor.getDirectUrl(url, format.format_id);
            await this.telegramHelper.sendDirectLink(chatId, directUrl, quality, format.format_id, url);
            
            await this.bot.sendMessage(chatId, 
              `ℹ️ Выбранный формат временно недоступен. Отправляю прямую ссылку для скачивания.`
            );
            
            return;
          }
        } catch (fallbackError) {
          Logger.error('All fallback methods failed', fallbackError, { userId });
          
          await this.bot.sendMessage(chatId, 
            `❌ Произошла ошибка\n` +
            `Выбранный формат видео временно недоступен. Попробуйте другое качество или повторите попытку позже.`
          );
          
          return;
        }
      }
      
      // Если ошибка 413 (файл слишком большой для Telegram), пытаемся отправить прямую ссылку
      if (error.message && error.message.includes('413')) {
        Logger.info('File upload failed with 413, trying direct URL fallback', { userId });
        
        try {
          // Для больших файлов ищем комбинированный формат того же разрешения
          const targetHeight = format.height;
          let directUrlFormat = format;
          
          // Ищем комбинированный формат того же разрешения
          const combinedFormat = videoInfo.formats.find(f =>
            f.vcodec && f.vcodec !== 'none' &&
            f.acodec && f.acodec !== 'none' &&
            f.height === targetHeight
          );
          
          if (combinedFormat) {
            Logger.info('Using combined format for direct URL fallback', { 
              userId, 
              originalFormat: format.format_id,
              combinedFormat: combinedFormat.format_id 
            });
            directUrlFormat = combinedFormat;
          }

          // Получаем прямую ссылку с fallback на другие форматы
          let directUrl = null;
          let usedFormat = directUrlFormat;
          
          try {
            directUrl = await this.videoProcessor.getDirectUrl(url, directUrlFormat.format_id);
          } catch (urlError) {
            Logger.warn('Failed to get direct URL for selected format in 413 fallback, trying alternatives', { 
              userId, 
              formatId: directUrlFormat.format_id,
              error: urlError.message 
            });
            
            // Пробуем другие форматы того же разрешения
            const alternativeFormats = videoInfo.formats.filter(f =>
              f.vcodec && f.vcodec !== 'none' &&
              f.height === targetHeight &&
              f.format_id !== directUrlFormat.format_id
            ).sort((a, b) => {
              // Приоритет: комбинированные форматы, потом по битрейту
              const aCombined = a.acodec && a.acodec !== 'none' ? 0 : 1;
              const bCombined = b.acodec && b.acodec !== 'none' ? 0 : 1;
              if (aCombined !== bCombined) return aCombined - bCombined;
              return (b.tbr || 0) - (a.tbr || 0);
            });
            
            for (const altFormat of alternativeFormats) {
              try {
                Logger.info('Trying alternative format for direct URL in 413 fallback', { 
                  userId, 
                  formatId: altFormat.format_id 
                });
                directUrl = await this.videoProcessor.getDirectUrl(url, altFormat.format_id);
                usedFormat = altFormat;
                break;
              } catch (altError) {
                Logger.warn('Alternative format also failed in 413 fallback', { 
                  userId, 
                  formatId: altFormat.format_id,
                  error: altError.message 
                });
                continue;
              }
            }
            
            if (!directUrl) {
              throw urlError; // Если все форматы не сработали, выбрасываем оригинальную ошибку
            }
          }
          
          await this.telegramHelper.sendDirectLink(chatId, directUrl, quality, usedFormat.format_id, url);
          
          // Отправляем объяснение
          const fileSize = await this.fileManager.getFileSize(outputPath);
          const formatInfo = combinedFormat ? 
            `ℹ️ Не удалось загрузить видео в Telegram (размер: ${this.formatFileSize(fileSize)}). Отправляю прямую ссылку с видео и звуком для скачивания.` :
            `ℹ️ Не удалось загрузить видео в Telegram (размер: ${this.formatFileSize(fileSize)}). Отправляю прямую ссылку для скачивания.\n⚠️ Внимание: ссылка может содержать только видео без звука.`;
          
          await this.bot.sendMessage(chatId, formatInfo);
          
          return; // Успешно обработали через fallback
        } catch (fallbackError) {
          Logger.error('Fallback to direct URL also failed', fallbackError, { userId });
          
          // Если fallback не сработал, отправляем хотя бы сообщение об ошибке
          try {
            await this.bot.sendMessage(chatId, 
              `❌ Не удалось загрузить видео (размер: ${this.formatFileSize(await this.fileManager.getFileSize(outputPath))}). ` +
              `Файл слишком большой для Telegram.`
            );
          } catch (msgError) {
            Logger.error('Could not send error message', msgError, { userId });
          }
          
          throw new Error('UPLOAD_FAILED');
        }
      }
      
      throw error;
    } finally {
      // Очищаем временные файлы
      // Если файл используется сервером, не удаляем outputPath (он удалится автоматически по TTL)
      if (!fileUsedByServer) {
        if (videoPath || audioPath || outputPath) {
          await this.fileManager.deleteFiles([videoPath, audioPath, outputPath].filter(Boolean));
        }
      } else {
        // Если файл на сервере, удаляем только промежуточные файлы (если они еще не удалены)
        if (videoPath || audioPath) {
          await this.fileManager.deleteFiles([videoPath, audioPath].filter(Boolean));
        }
      }
    }
  }

  /**
   * Запуск бота
   */
  async start() {
    Logger.info('Starting YouTube Downloader Bot...', {
      nodeEnv: this.config.NODE_ENV,
      allowedUsers: this.config.ALLOWED_USERS.length > 0 ? this.config.ALLOWED_USERS.length : 'all',
      maxVideoDuration: this.config.MAX_VIDEO_DURATION || 'unlimited'
    });
    
    await this.initialize();
    
    Logger.info('Bot started successfully! Waiting for messages...');
  }

  /**
   * Форматирует размер файла в читаемый вид
   * @param {number} bytes - размер в байтах
   * @returns {string} - отформатированный размер
   */
  formatFileSize(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
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
    await botController.start();
    
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
