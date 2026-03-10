const JokeManager = require('./jokeManager');
const fs = require('fs');
const path = require('path');

// Мокаем fs для тестов
jest.mock('fs');

describe('JokeManager', () => {
  let jokeManager;
  let mockTelegramApi;

  beforeEach(() => {
    // Мокаем TelegramApi
    mockTelegramApi = {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 1 })
    };

    // Очищаем все моки
    jest.clearAllMocks();
    
    // Очищаем все таймеры
    jest.clearAllTimers();
    jest.useFakeTimers();

    // По умолчанию мокаем отсутствие файла, чтобы не загружались реальные шутки
    fs.existsSync.mockReturnValue(false);

    jokeManager = new JokeManager(mockTelegramApi);
  });

  afterEach(() => {
    // Останавливаем все интервалы
    jokeManager.stopAllIntervals();
    jest.useRealTimers();
  });

  describe('loadJokes', () => {
    test('должен загрузить шутки из файла', () => {
      const mockJokesData = {
        short_dark_jokes: [
          { id: 1, text: 'Шутка 1' },
          { id: 2, text: 'Шутка 2' }
        ],
        dark_anecdotes: [
          { id: 1, text: 'Анекдот 1' }
        ],
        dark_memes: [
          { id: 1, text: 'Мем 1' }
        ]
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockJokesData));

      jokeManager.loadJokes();

      expect(jokeManager.jokes).toHaveLength(4);
      expect(jokeManager.jokes[0].text).toBe('Шутка 1');
      expect(jokeManager.jokes[3].text).toBe('Мем 1');
    });

    test('должен обработать отсутствие файла', () => {
      fs.existsSync.mockReturnValue(false);

      jokeManager.loadJokes();

      expect(jokeManager.jokes).toHaveLength(0);
    });

    test('должен обработать ошибку чтения файла', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      jokeManager.loadJokes();

      expect(jokeManager.jokes).toHaveLength(0);
    });
  });

  describe('getRandomJoke', () => {
    test('должен вернуть случайную шутку', () => {
      jokeManager.jokes = [
        { id: 1, text: 'Шутка 1' },
        { id: 2, text: 'Шутка 2' }
      ];

      const joke = jokeManager.getRandomJoke();

      expect(joke).toBeDefined();
      expect(['Шутка 1', 'Шутка 2']).toContain(joke);
    });

    test('должен вернуть null если нет шуток', () => {
      jokeManager.jokes = [];

      const joke = jokeManager.getRandomJoke();

      expect(joke).toBeNull();
    });
  });

  describe('startJokeInterval', () => {
    test('должен запустить интервал отправки шуток', () => {
      jokeManager.jokes = [{ id: 1, text: 'Тестовая шутка' }];
      const chatId = 12345;

      jokeManager.startJokeInterval(chatId, 1); // 1 секунда для теста

      expect(jokeManager.isIntervalActive(chatId)).toBe(true);
      expect(jokeManager.getActiveIntervalsCount()).toBe(1);

      // Проверяем, что через 1 секунду отправится шутка
      jest.advanceTimersByTime(1000);

      expect(mockTelegramApi.sendMessage).toHaveBeenCalledWith(
        chatId,
        '😄 Тестовая шутка'
      );
    });

    test('должен остановить предыдущий интервал при запуске нового', () => {
      jokeManager.jokes = [{ id: 1, text: 'Шутка' }];
      const chatId = 12345;

      // Запускаем первый интервал
      jokeManager.startJokeInterval(chatId, 1);
      const firstIntervalActive = jokeManager.isIntervalActive(chatId);

      // Запускаем второй интервал для того же чата
      jokeManager.startJokeInterval(chatId, 2);

      expect(firstIntervalActive).toBe(true);
      expect(jokeManager.isIntervalActive(chatId)).toBe(true);
      expect(jokeManager.getActiveIntervalsCount()).toBe(1); // Должен быть только один
    });

    test('не должен запускать интервал если нет шуток', () => {
      jokeManager.jokes = [];
      const chatId = 12345;

      jokeManager.startJokeInterval(chatId);

      expect(jokeManager.isIntervalActive(chatId)).toBe(false);
      expect(jokeManager.getActiveIntervalsCount()).toBe(0);
    });
  });

  describe('stopJokeInterval', () => {
    test('должен остановить интервал для чата', () => {
      jokeManager.jokes = [{ id: 1, text: 'Шутка' }];
      const chatId = 12345;

      jokeManager.startJokeInterval(chatId);
      expect(jokeManager.isIntervalActive(chatId)).toBe(true);

      jokeManager.stopJokeInterval(chatId);
      expect(jokeManager.isIntervalActive(chatId)).toBe(false);
      expect(jokeManager.getActiveIntervalsCount()).toBe(0);
    });

    test('должен корректно обработать остановку несуществующего интервала', () => {
      const chatId = 12345;

      // Не должно выбросить ошибку
      expect(() => {
        jokeManager.stopJokeInterval(chatId);
      }).not.toThrow();

      expect(jokeManager.isIntervalActive(chatId)).toBe(false);
    });
  });

  describe('stopAllIntervals', () => {
    test('должен остановить все активные интервалы', () => {
      jokeManager.jokes = [{ id: 1, text: 'Шутка' }];

      // Запускаем несколько интервалов
      jokeManager.startJokeInterval(111);
      jokeManager.startJokeInterval(222);
      jokeManager.startJokeInterval(333);

      expect(jokeManager.getActiveIntervalsCount()).toBe(3);

      jokeManager.stopAllIntervals();

      expect(jokeManager.getActiveIntervalsCount()).toBe(0);
      expect(jokeManager.isIntervalActive(111)).toBe(false);
      expect(jokeManager.isIntervalActive(222)).toBe(false);
      expect(jokeManager.isIntervalActive(333)).toBe(false);
    });
  });

  describe('sendRandomJoke', () => {
    test('должен отправить одну случайную шутку', async () => {
      jokeManager.jokes = [{ id: 1, text: 'Одиночная шутка' }];
      const chatId = 12345;

      const result = await jokeManager.sendRandomJoke(chatId);

      expect(result).toBe(true);
      expect(mockTelegramApi.sendMessage).toHaveBeenCalledWith(
        chatId,
        '😄 Одиночная шутка'
      );
    });

    test('должен вернуть false если нет шуток', async () => {
      jokeManager.jokes = [];
      const chatId = 12345;

      const result = await jokeManager.sendRandomJoke(chatId);

      expect(result).toBe(false);
      expect(mockTelegramApi.sendMessage).not.toHaveBeenCalled();
    });

    test('должен обработать ошибку отправки', async () => {
      jokeManager.jokes = [{ id: 1, text: 'Шутка' }];
      mockTelegramApi.sendMessage.mockRejectedValue(new Error('Send failed'));
      const chatId = 12345;

      const result = await jokeManager.sendRandomJoke(chatId);

      expect(result).toBe(false);
    });
  });

  describe('reloadJokes', () => {
    test('должен перезагрузить шутки', () => {
      const mockJokesData = {
        short_dark_jokes: [{ id: 1, text: 'Новая шутка' }]
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockJokesData));

      jokeManager.reloadJokes();

      expect(jokeManager.jokes).toHaveLength(1);
      expect(jokeManager.jokes[0].text).toBe('Новая шутка');
    });
  });
});