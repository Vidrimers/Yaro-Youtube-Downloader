const path = require('path');
const { Logger } = require('./utils');

/**
 * StatsManager - статистика скачиваний через SQLite
 */
class StatsManager {
  constructor(dbPath) {
    this.dbPath = dbPath || path.resolve('stats.db');
    this.db = null;
  }

  async initialize() {
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);

    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        platform TEXT NOT NULL,
        video_id TEXT,
        title TEXT,
        quality TEXT,
        remove_ads INTEGER DEFAULT 0,
        trimmed INTEGER DEFAULT 0,
        user_id TEXT,
        extension_version TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON downloads(timestamp);
      CREATE INDEX IF NOT EXISTS idx_source ON downloads(source);
      CREATE INDEX IF NOT EXISTS idx_platform ON downloads(platform);
    `);

    Logger.info('StatsManager initialized', { dbPath: this.dbPath });
  }

  recordDownload(options = {}) {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT INTO downloads (timestamp, source, platform, video_id, title, quality, remove_ads, trimmed, user_id, extension_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      Date.now(),
      options.source || 'unknown',
      options.platform || 'unknown',
      options.videoId || null,
      options.title || null,
      options.quality || null,
      options.removeAds ? 1 : 0,
      options.trimmed ? 1 : 0,
      options.userId || null,
      options.extensionVersion || null
    );
  }

  getStats() {
    if (!this.db) return null;

    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const totalBot = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE source = 'bot'").get().c;
    const totalExt = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE source = 'extension'").get().c;

    const botYoutube = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE source = 'bot' AND platform = 'youtube'").get().c;
    const botInstagram = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE source = 'bot' AND platform = 'instagram'").get().c;

    const extYoutube = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE source = 'extension' AND platform = 'youtube'").get().c;
    const extInstagram = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE source = 'extension' AND platform = 'instagram'").get().c;

    const todayBot = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE source = 'bot' AND timestamp > ?").get(dayAgo).c;
    const todayExt = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE source = 'extension' AND timestamp > ?").get(dayAgo).c;

    const sponsorBlockUsed = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE remove_ads = 1").get().c;
    const trimsUsed = this.db.prepare("SELECT COUNT(*) as c FROM downloads WHERE trimmed = 1").get().c;

    const uniqueBotUsers = this.db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM downloads WHERE source = 'bot' AND user_id IS NOT NULL").get().c;
    const uniqueExtIps = this.db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM downloads WHERE source = 'extension' AND user_id IS NOT NULL").get().c;

    const versions = this.db.prepare(
      "SELECT extension_version, COUNT(*) as c FROM downloads WHERE source = 'extension' AND extension_version IS NOT NULL GROUP BY extension_version ORDER BY c DESC"
    ).all();

    const weekByDay = this.db.prepare(
      "SELECT date(timestamp/1000, 'unixepoch', 'localtime') as day, COUNT(*) as c FROM downloads WHERE timestamp > ? GROUP BY day ORDER BY day"
    ).all(weekAgo);

    return {
      total: { bot: totalBot, extension: totalExt, all: totalBot + totalExt },
      youtube: { bot: botYoutube, extension: extYoutube },
      instagram: { bot: botInstagram, extension: extInstagram },
      today: { bot: todayBot, extension: todayExt },
      sponsorBlockUsed,
      trimsUsed,
      uniqueUsers: { bot: uniqueBotUsers, extension: uniqueExtIps },
      extensionVersions: versions,
      weekByDay
    };
  }

  getTopVideos(limit = 5) {
    if (!this.db) return [];
    return this.db.prepare(
      "SELECT video_id, title, COUNT(*) as downloads FROM downloads WHERE video_id IS NOT NULL GROUP BY video_id ORDER BY downloads DESC LIMIT ?"
    ).all(limit);
  }

  formatStatsText(stats) {
    if (!stats) return '⚠️ Статистика недоступна';

    let text = '📊 <b>Статистика</b>\n\n';

    text += '🤖 <b>Бот:</b>\n';
    text += `  Всего: ${stats.total.bot}\n`;
    text += `  YouTube: ${stats.youtube.bot} | Instagram: ${stats.instagram.bot}\n`;
    text += `  Сегодня: ${stats.today.bot}\n\n`;

    text += '🧩 <b>Расширение:</b>\n';
    text += `  Всего: ${stats.total.extension}\n`;
    text += `  YouTube: ${stats.youtube.extension} | Instagram: ${stats.instagram.extension}\n`;
    text += `  Сегодня: ${stats.today.extension}\n\n`;

    text += `🎯 SponsorBlock: ${stats.sponsorBlockUsed} раз\n`;
    text += `✂️ Обрезка: ${stats.trimsUsed} раз\n\n`;

    text += '👥 <b>Уникальные:</b>\n';
    text += `  Бот users: ${stats.uniqueUsers.bot}\n`;
    text += `  Extension IPs: ${stats.uniqueUsers.extension}\n\n`;

    if (stats.extensionVersions.length > 0) {
      text += '📦 <b>Версии расширения:</b>\n';
      stats.extensionVersions.forEach(v => {
        text += `  v${v.extension_version}: ${v.c}\n`;
      });
      text += '\n';
    }

    if (stats.weekByDay.length > 0) {
      text += '📅 <b>Последние 7 дней:</b>\n';
      stats.weekByDay.forEach(d => {
        text += `  ${d.day}: ${d.c}\n`;
      });
    }

    return text;
  }
}

module.exports = StatsManager;
