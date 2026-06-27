const { URLValidator, Logger } = require('./utils');
const fs = require('fs');

/**
 * ExtensionAPI - REST API для Chrome расширения
 * Предоставляет эндпоинты для скачивания YouTube/Instagram видео
 */
class ExtensionAPI {
  constructor(app, options = {}) {
    this.app = app;
    this.videoProcessor = options.videoProcessor;
    this.fileManager = options.fileManager;
    this.fileServer = options.fileServer;
    this.sponsorBlock = options.sponsorBlock;
    this.config = options.config;
    this.apiKey = options.apiKey;
    this.statsManager = options.statsManager;
    this.jokeManager = options.jokeManager;

    this.setupRoutes();
  }

  setupRoutes() {
    this.app.use('/api', (req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
      res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);

      if (this.apiKey) {
        const provided = req.headers['x-api-key'];
        if (provided !== this.apiKey) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }
      next();
    });

    this.app.post('/api/info', (req, res) => this.handleInfo(req, res));
    this.app.post('/api/download', (req, res) => this.handleDownload(req, res));
    this.app.post('/api/download/instagram', (req, res) => this.handleInstagramDownload(req, res));
    this.app.get('/api/joke', (req, res) => this.handleJoke(req, res));
  }

  parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  async handleInfo(req, res) {
    try {
      const { url } = await this.parseBody(req);
      if (!url) return res.status(400).json({ error: 'url is required' });

      if (URLValidator.isInstagramUrl(url)) {
        return res.json({
          type: 'instagram',
          url,
          title: 'Instagram video',
          formats: [{ quality: 'default', label: 'Скачать' }]
        });
      }

      if (!URLValidator.isYouTubeUrl(url)) {
        return res.status(400).json({ error: 'Unsupported URL' });
      }

      const normalizedUrl = URLValidator.normalizeUrl(url);
      const videoInfo = await this.videoProcessor.getVideoInfo(normalizedUrl);
      const formats = this.videoProcessor.filterAndSortFormats(videoInfo.formats);

      let sponsorBlock = null;
      if (this.config.SPONSORBLOCK_ENABLED && videoInfo.id) {
        try {
          const segments = await this.sponsorBlock.getSegments(videoInfo.id);
          if (segments && segments.length > 0) {
            sponsorBlock = this.sponsorBlock.formatSegmentsInfo(segments);
          }
        } catch (e) {
          Logger.warn('SponsorBlock failed in API', { error: e.message });
        }
      }

      res.json({
        type: 'youtube',
        id: videoInfo.id,
        title: videoInfo.title,
        duration: videoInfo.duration,
        thumbnail: videoInfo.thumbnail,
        uploader: videoInfo.uploader,
        formats: formats.map(f => ({
          formatId: f.format_id,
          quality: f.format_note || `${f.height}p`,
          height: f.height,
          isCombined: this.videoProcessor.isCombinedFormat(f),
          needsMerge: !this.videoProcessor.isCombinedFormat(f),
          filesize: f.filesize
        })),
        sponsorBlock
      });
    } catch (error) {
      Logger.error('API /info error', error);
      res.status(500).json({ error: error.message || 'Internal error' });
    }
  }

  async handleDownload(req, res) {
    try {
      const body = await this.parseBody(req);
      const { url, formatId, quality, removeAds, sponsorCategories, trimStart, trimEnd } = body;

      if (!url) return res.status(400).json({ error: 'url is required' });

      if (URLValidator.isInstagramUrl(url)) {
        return this.handleInstagramDownload(req, res, body);
      }

      if (!URLValidator.isYouTubeUrl(url)) {
        return res.status(400).json({ error: 'Unsupported URL' });
      }

      const normalizedUrl = URLValidator.normalizeUrl(url);
      const videoInfo = await this.videoProcessor.getVideoInfo(normalizedUrl);
      if (!videoInfo || !videoInfo.formats) {
        return res.status(400).json({ error: 'Video unavailable' });
      }

      let format;
      if (formatId) {
        format = videoInfo.formats.find(f => f.format_id === formatId);
      }
      if (!format && quality) {
        const h = parseInt(quality);
        format = videoInfo.formats.find(f => f.height === h);
      }
      if (!format) {
        const formats = this.videoProcessor.filterAndSortFormats(videoInfo.formats);
        format = formats[0];
      }
      if (!format) {
        return res.status(400).json({ error: 'No suitable format found' });
      }

      // Prefer combined formats to avoid 403 on video-only streams
      if (!this.videoProcessor.isCombinedFormat(format)) {
        const h = format.height || parseInt(quality) || 0;
        const combined = videoInfo.formats.find(f =>
          this.videoProcessor.isCombinedFormat(f) && f.height === h
        );
        if (combined) {
          format = combined;
        }
      }

      const videoId = videoInfo.id || 'video';
      const videoPath = this.fileManager.generateFilePath(videoId, 'video.mp4');
      const audioPath = this.fileManager.generateFilePath(videoId, 'audio.m4a');
      const mergedPath = this.fileManager.generateFilePath(videoId, 'merged.mp4');
      const outputPath = this.fileManager.generateFilePath(videoId, 'final.mp4');

      let sponsorSegments = null;
      const shouldRemoveSponsor = removeAds || (sponsorCategories && sponsorCategories.length > 0);
      if (shouldRemoveSponsor && this.config.SPONSORBLOCK_ENABLED && videoId) {
        try {
          const segments = await this.sponsorBlock.getSegments(videoId);
          if (segments && segments.length > 0) {
            if (sponsorCategories && sponsorCategories.length > 0) {
              sponsorSegments = this.sponsorBlock.filterSegmentsByCategories(segments, sponsorCategories);
            } else {
              sponsorSegments = segments;
            }
          }
        } catch (e) {
          Logger.warn('SponsorBlock failed', { error: e.message });
        }
      }

      const isCombined = this.videoProcessor.isCombinedFormat(format);
      const cookiesFile = this.config.YOUTUBE_COOKIES_FILE || undefined;

      // Use yt-dlp's merge for all formats to avoid 403 on video-only streams
      // Let yt-dlp handle format selection and merging internally
      try {
        const mergeArgs = [
          '-f', `${format.format_id}+bestaudio/best`,
          '--merge-output-format', 'mp4',
          '--extractor-args', 'youtube:player_client=web_creator',
          '-o', videoPath,
          '--no-warnings'
        ];
        if (cookiesFile) mergeArgs.push('--cookies', cookiesFile);
        mergeArgs.push(normalizedUrl);
        
        await this.videoProcessor.executeYtDlp(mergeArgs, 300000);
      } catch (dlError) {
        Logger.warn('Format download failed, trying best available', { error: dlError.message, formatId: format.format_id });
        // Fallback: let yt-dlp choose the best format
        const fallbackArgs = [
          '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
          '--merge-output-format', 'mp4',
          '--extractor-args', 'youtube:player_client=web_creator',
          '-o', videoPath,
          '--no-warnings'
        ];
        if (cookiesFile) fallbackArgs.push('--cookies', cookiesFile);
        fallbackArgs.push(normalizedUrl);
        
        await this.videoProcessor.executeYtDlp(fallbackArgs, 300000);
      }

      const sourceFile = videoPath;
      let finalFile = sourceFile;

      if (sponsorSegments && sponsorSegments.length > 0) {
        await this.fileManager.removeSegments(sourceFile, outputPath, sponsorSegments);
        finalFile = outputPath;
      }

      if (trimStart !== undefined || trimEnd !== undefined) {
        const trimOutput = this.fileManager.generateFilePath(videoId, 'trimmed.mp4');
        const start = trimStart || null;
        const end = trimEnd || null;
        await this.fileManager.trimVideo(finalFile, trimOutput, start, end);
        finalFile = trimOutput;
      }

      const title = (videoInfo.title || 'video').replace(/[<>:"/\\|?*]/g, '').substring(0, 100);
      const tempLink = await this.fileServer.createTemporaryLink(finalFile, `${title}.mp4`);

      if (this.statsManager) {
        this.statsManager.recordDownload({
          source: 'extension',
          platform: 'youtube',
          videoId: videoId,
          title: videoInfo.title,
          quality: quality || format?.format_note || `${format?.height}p` || null,
          removeAds: !!removeAds,
          trimmed: trimStart !== undefined || trimEnd !== undefined,
          userId: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
          extensionVersion: req.headers['x-extension-version'] || null
        });
      }

      this.cleanupTempFiles([videoPath, audioPath, mergedPath, outputPath, finalFile === sourceFile ? null : finalFile].filter(Boolean), finalFile);

      res.json({
        downloadUrl: tempLink.downloadUrl,
        filename: `${title}.mp4`,
        expiresAt: tempLink.expiresAt,
        ttlMinutes: tempLink.ttlMinutes
      });
    } catch (error) {
      Logger.error('API /download error', error);
      res.status(500).json({ error: error.message || 'Download failed' });
    }
  }

  async handleInstagramDownload(req, res, body) {
    try {
      if (!body) body = await this.parseBody(req);
      const { url } = body;

      if (!url) return res.status(400).json({ error: 'url is required' });
      if (!URLValidator.isInstagramUrl(url)) {
        return res.status(400).json({ error: 'Not an Instagram URL' });
      }

      const outputPath = this.fileManager.generateFilePath('ig', 'instagram.mp4');
      const cookiesFile = this.config.INSTAGRAM_COOKIES_FILE || undefined;

      await this.videoProcessor.downloadInstagram(url, outputPath, 300000, cookiesFile);

      if (this.statsManager) {
        this.statsManager.recordDownload({
          source: 'extension',
          platform: 'instagram',
          videoId: null,
          title: 'Instagram video',
          quality: null,
          userId: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
          extensionVersion: req.headers['x-extension-version'] || null
        });
      }

      const tempLink = await this.fileServer.createTemporaryLink(outputPath, 'instagram_video.mp4');

      setTimeout(() => {
        this.fileManager.deleteFile(outputPath).catch(() => {});
      }, (tempLink.ttlMinutes || 10) * 60 * 1000 + 60000);

      res.json({
        downloadUrl: tempLink.downloadUrl,
        filename: 'instagram_video.mp4',
        expiresAt: tempLink.expiresAt,
        ttlMinutes: tempLink.ttlMinutes
      });
    } catch (error) {
      Logger.error('API /download/instagram error', error);
      res.status(500).json({ error: error.message || 'Instagram download failed' });
    }
  }

  cleanupTempFiles(files, keepFile) {
    setTimeout(() => {
      for (const f of files) {
        if (f !== keepFile) {
          this.fileManager.deleteFile(f).catch(() => {});
        }
      }
    }, 60000);
  }

  handleJoke(req, res) {
    try {
      if (!this.jokeManager || !this.jokeManager.jokes || this.jokeManager.jokes.length === 0) {
        return res.json({ joke: null });
      }
      const jokeText = this.jokeManager.getRandomJoke();
      res.json({ joke: jokeText });
    } catch (e) {
      res.json({ joke: null });
    }
  }
}

module.exports = ExtensionAPI;
