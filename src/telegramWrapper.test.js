const TelegramApiWrapper = require('./telegramWrapper');

// Мокаем Logger
jest.mock('./utils', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('TelegramApiWrapper', () => {
  let mockBot;
  let wrapper;

  beforeEach(() => {
    mockBot = {
      sendMessage: jest.fn(),
      sendVideo: jest.fn(),
      sendDocument: jest.fn(),
      editMessageText: jest.fn(),
      deleteMessage: jest.fn(),
      answerCallbackQuery: jest.fn(),
      sendChatAction: jest.fn(),
      getFile: jest.fn()
    };

    wrapper = new TelegramApiWrapper(mockBot, {
      maxRetries: 2,
      baseDelay: 100,
      maxDelay: 1000
    });
  });

  describe('isRetryableError', () => {
    test('should identify retryable network errors', () => {
      const retryableErrors = [
        new Error('Client network socket disconnected'),
        new Error('ECONNRESET'),
        new Error('ETIMEDOUT'),
        { code: 'ENOTFOUND' },
        { message: 'socket hang up' }
      ];

      retryableErrors.forEach(error => {
        expect(wrapper.isRetryableError(error)).toBe(true);
      });
    });

    test('should not retry non-network errors', () => {
      const nonRetryableErrors = [
        new Error('Bad Request: message is too long'),
        new Error('Forbidden: bot was blocked by the user'),
        { code: 'INVALID_TOKEN' }
      ];

      nonRetryableErrors.forEach(error => {
        expect(wrapper.isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('calculateDelay', () => {
    test('should calculate exponential backoff delays', () => {
      expect(wrapper.calculateDelay(0)).toBe(100);  // baseDelay * 2^0
      expect(wrapper.calculateDelay(1)).toBe(200);  // baseDelay * 2^1
      expect(wrapper.calculateDelay(2)).toBe(400);  // baseDelay * 2^2
    });

    test('should not exceed maxDelay', () => {
      const wrapper = new TelegramApiWrapper(mockBot, {
        baseDelay: 100,
        maxDelay: 300
      });

      expect(wrapper.calculateDelay(5)).toBe(300); // Should be capped at maxDelay
    });
  });

  describe('executeWithRetry', () => {
    test('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await wrapper.executeWithRetry(operation, 'testOperation');
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should retry on retryable errors', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('success');
      
      const result = await wrapper.executeWithRetry(operation, 'testOperation');
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test('should not retry non-retryable errors', async () => {
      const operation = jest.fn()
        .mockRejectedValue(new Error('Bad Request'));
      
      await expect(wrapper.executeWithRetry(operation, 'testOperation'))
        .rejects.toThrow('Bad Request');
      
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should fail after max retries', async () => {
      const operation = jest.fn()
        .mockRejectedValue(new Error('ECONNRESET'));
      
      await expect(wrapper.executeWithRetry(operation, 'testOperation'))
        .rejects.toThrow('ECONNRESET');
      
      expect(operation).toHaveBeenCalledTimes(3); // 1 + 2 retries
    });
  });

  describe('sendMessage', () => {
    test('should call bot.sendMessage with retry', async () => {
      mockBot.sendMessage.mockResolvedValue({ message_id: 123 });
      
      const result = await wrapper.sendMessage(12345, 'test message');
      
      expect(result).toEqual({ message_id: 123 });
      expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, 'test message', {});
    });

    test('should retry on network error', async () => {
      mockBot.sendMessage
        .mockRejectedValueOnce(new Error('Client network socket disconnected'))
        .mockResolvedValue({ message_id: 123 });
      
      const result = await wrapper.sendMessage(12345, 'test message');
      
      expect(result).toEqual({ message_id: 123 });
      expect(mockBot.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendVideo', () => {
    test('should call bot.sendVideo with retry', async () => {
      mockBot.sendVideo.mockResolvedValue({ message_id: 123 });
      
      const result = await wrapper.sendVideo(12345, 'video.mp4');
      
      expect(result).toEqual({ message_id: 123 });
      expect(mockBot.sendVideo).toHaveBeenCalledWith(12345, 'video.mp4', {});
    });
  });

  describe('getMethodProxy', () => {
    test('should proxy wrapped methods to wrapper', () => {
      const proxy = wrapper.getMethodProxy();
      
      // Проверяем, что обернутые методы используют wrapper
      expect(typeof proxy.sendMessage).toBe('function');
      // Проверяем, что это действительно метод wrapper'а, а не оригинального бота
      expect(proxy.sendMessage.name).toBe('bound sendMessage');
    });

    test('should proxy unwrapped methods to original bot', () => {
      mockBot.someOtherMethod = jest.fn();
      const proxy = wrapper.getMethodProxy();
      
      expect(typeof proxy.someOtherMethod).toBe('function');
    });
  });
});