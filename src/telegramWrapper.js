const { Logger } = require('./utils');

/**
 * TelegramApiWrapper - обертка для Telegram Bot API с retry механизмом
 * Решает проблемы с сетевыми сбоями и TLS ошибками
 */
class TelegramApiWrapper {
  constructor(bot, options = {}) {
    this.bot = bot;
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000; // 1 секунда
    this.maxDelay = options.maxDelay || 10000; // 10 секунд
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
   * Выполняет операцию с retry механизмом
   */
  async executeWithRetry(operation, operationName, context = {}) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await operation();
        
        if (attempt > 0) {
          Logger.info(`${operationName} succeeded after retry`, { 
            attempt, 
            ...context 
          });
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        // Если это последняя попытка или ошибка не повторяемая
        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          Logger.error(`${operationName} failed after ${attempt + 1} attempts`, error, {
            isRetryable: this.isRetryableError(error),
            ...context
          });
          throw error;
        }
        
        // Логируем попытку retry
        const delay = this.calculateDelay(attempt);
        Logger.warn(`${operationName} failed, retrying in ${delay}ms`, {
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
   * Отправка сообщения с retry
   */
  async sendMessage(chatId, text, options = {}) {
    return this.executeWithRetry(
      () => this.bot.sendMessage(chatId, text, options),
      'sendMessage',
      { chatId, textLength: text?.length }
    );
  }

  /**
   * Отправка видео с retry
   */
  async sendVideo(chatId, video, options = {}) {
    return this.executeWithRetry(
      () => this.bot.sendVideo(chatId, video, options),
      'sendVideo', 
      { chatId, videoType: typeof video }
    );
  }

  /**
   * Отправка документа с retry
   */
  async sendDocument(chatId, document, options = {}) {
    return this.executeWithRetry(
      () => this.bot.sendDocument(chatId, document, options),
      'sendDocument',
      { chatId, documentType: typeof document }
    );
  }

  /**
   * Редактирование сообщения с retry
   */
  async editMessageText(text, options = {}) {
    return this.executeWithRetry(
      () => this.bot.editMessageText(text, options),
      'editMessageText',
      { chatId: options.chat_id, messageId: options.message_id }
    );
  }

  /**
   * Удаление сообщения с retry
   */
  async deleteMessage(chatId, messageId) {
    return this.executeWithRetry(
      () => this.bot.deleteMessage(chatId, messageId),
      'deleteMessage',
      { chatId, messageId }
    );
  }

  /**
   * Ответ на callback query с retry
   */
  async answerCallbackQuery(callbackQueryId, options = {}) {
    return this.executeWithRetry(
      () => this.bot.answerCallbackQuery(callbackQueryId, options),
      'answerCallbackQuery',
      { callbackQueryId }
    );
  }

  /**
   * Отправка chat action с retry
   */
  async sendChatAction(chatId, action) {
    return this.executeWithRetry(
      () => this.bot.sendChatAction(chatId, action),
      'sendChatAction',
      { chatId, action }
    );
  }

  /**
   * Получение информации о файле с retry
   */
  async getFile(fileId) {
    return this.executeWithRetry(
      () => this.bot.getFile(fileId),
      'getFile',
      { fileId }
    );
  }

  /**
   * Прокси для всех остальных методов бота без retry
   * (для методов, которые не требуют сетевых запросов)
   */
  getMethodProxy() {
    return new Proxy(this.bot, {
      get: (target, prop) => {
        // Если метод уже обернут в wrapper, используем его
        if (typeof this[prop] === 'function') {
          return this[prop].bind(this);
        }
        
        // Для остальных методов возвращаем оригинал
        const originalMethod = target[prop];
        if (typeof originalMethod === 'function') {
          return originalMethod.bind(target);
        }
        
        return originalMethod;
      }
    });
  }
}

module.exports = TelegramApiWrapper;