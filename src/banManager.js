const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('./utils');

const BANS_FILE = path.resolve('bans.json');

// Длительности банов в миллисекундах
const BAN_DURATIONS = {
  '1h':       60 * 60 * 1000,
  '5h':       5 * 60 * 60 * 1000,
  '1d':       24 * 60 * 60 * 1000,
  '1w':       7 * 24 * 60 * 60 * 1000,
  '1m':       30 * 24 * 60 * 60 * 1000,
  'forever':  null
};

const BAN_LABELS = {
  '1h':      '1 час',
  '5h':      '5 часов',
  '1d':      '1 день',
  '1w':      'Неделя',
  '1m':      'Месяц',
  'forever': 'Навсегда'
};

class BanManager {
  constructor() {
    // Map<userId, { until: timestamp|null, username: string }>
    this.bans = new Map();
  }

  async load() {
    try {
      const data = await fs.readFile(BANS_FILE, 'utf8');
      const json = JSON.parse(data);
      this.bans = new Map(Object.entries(json).map(([id, info]) => [parseInt(id), info]));
      Logger.info('Bans loaded', { count: this.bans.size });
    } catch {
      // Файл не существует — начинаем с пустого списка
      this.bans = new Map();
    }
  }

  async save() {
    const obj = {};
    for (const [userId, info] of this.bans) {
      obj[userId] = info;
    }
    await fs.writeFile(BANS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  }

  /**
   * Проверяет, забанен ли пользователь
   * @returns {{ banned: boolean, until: number|null }}
   */
  isBanned(userId) {
    const info = this.bans.get(userId);
    if (!info) return { banned: false };

    // Навсегда
    if (info.until === null) return { banned: true, until: null };

    // Временный бан — проверяем не истёк ли
    if (Date.now() < info.until) return { banned: true, until: info.until };

    // Бан истёк — удаляем
    this.bans.delete(userId);
    this.save().catch(() => {});
    return { banned: false, justUnbanned: true };
  }

  /**
   * Банит пользователя
   * @param {number} userId
   * @param {string} username
   * @param {string} duration - ключ из BAN_DURATIONS
   * @param {string|null} reason - причина бана
   */
  async ban(userId, username, duration, reason = null) {
    const ms = BAN_DURATIONS[duration];
    const until = ms === null ? null : Date.now() + ms;
    this.bans.set(userId, { until, username, reason });
    await this.save();
    Logger.info('User banned', { userId, username, duration, until, reason });
  }

  /**
   * Разбанивает пользователя
   */
  async unban(userId) {
    this.bans.delete(userId);
    await this.save();
    Logger.info('User unbanned', { userId });
  }

  /**
   * Форматирует время окончания бана
   */
  formatUntil(until) {
    if (until === null) return 'навсегда';
    return new Date(until).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  }

  /**
   * Возвращает inline клавиатуру с выбором срока бана
   */
  getBanKeyboard(userId) {
    return {
      inline_keyboard: [
        [
          { text: '1 час',   callback_data: `ban_${userId}_1h` },
          { text: '5 часов', callback_data: `ban_${userId}_5h` },
          { text: '1 день',  callback_data: `ban_${userId}_1d` }
        ],
        [
          { text: 'Неделя',   callback_data: `ban_${userId}_1w` },
          { text: 'Месяц',    callback_data: `ban_${userId}_1m` },
          { text: '🔴 Навсегда', callback_data: `ban_${userId}_forever` }
        ]
      ]
    };
  }

  /**
   * Возвращает список активных банов
   * @returns {Array<{ userId, username, until, reason }>}
   */
  getActiveBans() {
    const now = Date.now();
    const result = [];
    for (const [userId, info] of this.bans) {
      // Пропускаем истёкшие временные баны
      if (info.until !== null && now >= info.until) continue;
      result.push({ userId, username: info.username, until: info.until, reason: info.reason || null });
    }
    return result;
  }

  /**
   * Возвращает клавиатуру уведомления с кнопками "Бан" и "Ответить"
   */
  getNotifyKeyboard(userId, withReply = false) {
    const row1 = [{ text: '🚫 Бан', callback_data: `ban_menu_${userId}` }];
    if (withReply) row1.unshift({ text: '↩️ Ответить', callback_data: `reply_${userId}` });
    return { inline_keyboard: [row1] };
  }
}

module.exports = { BanManager, BAN_LABELS };
