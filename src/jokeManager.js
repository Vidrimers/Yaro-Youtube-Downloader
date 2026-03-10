const fs = require('fs');
const path = require('path');
const { Logger } = require('./utils');

/**
 * JokeManager - класс для управления шутками во время ожидания
 * Отправляет случайные шутки пользователям во время скачивания видео
 */
class JokeManager {
  constructor(telegramApi) {
    this.telegramApi = telegramApi;
    this.jokes = [];
    this.activeIntervals = new Map(); // chatId -> intervalId
    this.loadJokes();
  }

  /**
   * Загружает шутки из файла jokes.json
   */
  loadJokes() {
    try {
      const jokesPath = path.join(process.cwd(), 'wait-jokes', 'jokes.json');
      
      if (!fs.existsSync(jokesPath)) {
        Logger.warn('Jokes file not found', { path: jokesPath });
        return;
      }

      const jokesData = JSON.parse(fs.readFileSync(jokesPath, 'utf8'));
      
      // Объединяем все категории шуток в один массив
      this.jokes = [];
      
      if (jokesData.short_dark_jokes) {
        this.jokes.push(...jokesData.short_dark_jokes);
      }
      
      if (jokesData.dark_anecdotes) {
        this.jokes.push(...jokesData.dark_anecdotes);
      }
      
      if (jokesData.dark_memes) {
        this.jokes.push(...jokesData.dark_memes);
      }

      Logger.info('Jokes loaded successfully', { 
        totalJokes: this.jokes.length,
        categories: Object.keys(jokesData)
      });

    } catch (error) {
      Logger.error('Failed to load jokes', error);
      this.jokes = [];
    }
  }

  /**
   * Получает случайную шутку
   * @returns {string|null} - текст шутки или null если шуток нет
   */
  getRandomJoke() {
    if (this.jokes.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * this.jokes.length);
    const joke = this.jokes[randomIndex];
    
    return joke.text || null;
  }

  /**
   * Запускает отправку шуток для пользователя
   * @param {number} chatId - ID чата
   * @param {number} intervalSeconds - интервал в секундах (по умолчанию 20)
   */
  startJokeInterval(chatId, intervalSeconds = 20) {
    // Если уже есть активный интервал для этого чата, останавливаем его
    this.stopJokeInterval(chatId);

    // Проверяем, есть ли шутки
    if (this.jokes.length === 0) {
      Logger.warn('No jokes available for interval', { chatId });
      return;
    }

    Logger.info('Starting joke interval', { 
      chatId, 
      intervalSeconds,
      availableJokes: this.jokes.length 
    });

    // Создаем интервал для отправки шуток
    const intervalId = setInterval(async () => {
      try {
        const joke = this.getRandomJoke();
        
        if (joke) {
          await this.telegramApi.sendMessage(chatId, `😄 ${joke}`);
          Logger.info('Joke sent', { chatId, jokeLength: joke.length });
        }
        
      } catch (error) {
        Logger.warn('Failed to send joke', { 
          chatId, 
          error: error.message 
        });
        
        // Если ошибка отправки (например, чат заблокирован), останавливаем интервал
        if (error.message && error.message.includes('chat not found')) {
          this.stopJokeInterval(chatId);
        }
      }
    }, intervalSeconds * 1000);

    // Сохраняем ID интервала
    this.activeIntervals.set(chatId, intervalId);
  }

  /**
   * Останавливает отправку шуток для пользователя
   * @param {number} chatId - ID чата
   */
  stopJokeInterval(chatId) {
    const intervalId = this.activeIntervals.get(chatId);
    
    if (intervalId) {
      clearInterval(intervalId);
      this.activeIntervals.delete(chatId);
      
      Logger.info('Joke interval stopped', { chatId });
    }
  }

  /**
   * Останавливает все активные интервалы
   */
  stopAllIntervals() {
    for (const [chatId, intervalId] of this.activeIntervals) {
      clearInterval(intervalId);
      Logger.info('Stopped joke interval during cleanup', { chatId });
    }
    
    this.activeIntervals.clear();
    Logger.info('All joke intervals stopped');
  }

  /**
   * Получает количество активных интервалов
   * @returns {number} - количество активных интервалов
   */
  getActiveIntervalsCount() {
    return this.activeIntervals.size;
  }

  /**
   * Проверяет, активен ли интервал для чата
   * @param {number} chatId - ID чата
   * @returns {boolean} - true если интервал активен
   */
  isIntervalActive(chatId) {
    return this.activeIntervals.has(chatId);
  }

  /**
   * Отправляет одну случайную шутку (без интервала)
   * @param {number} chatId - ID чата
   * @returns {Promise<boolean>} - true если шутка отправлена успешно
   */
  async sendRandomJoke(chatId) {
    try {
      const joke = this.getRandomJoke();
      
      if (!joke) {
        Logger.warn('No jokes available for single send', { chatId });
        return false;
      }

      await this.telegramApi.sendMessage(chatId, `😄 ${joke}`);
      Logger.info('Single joke sent', { chatId });
      return true;
      
    } catch (error) {
      Logger.warn('Failed to send single joke', { 
        chatId, 
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Перезагружает шутки из файла
   */
  reloadJokes() {
    Logger.info('Reloading jokes from file');
    this.loadJokes();
  }
}

module.exports = JokeManager;