const FileManager = require('./fileManager');
const fs = require('fs').promises;
const path = require('path');

describe('FileManager', () => {
  let fileManager;
  const testTempDir = './test-temp';
  const mergeTimeout = 5000;

  beforeEach(() => {
    fileManager = new FileManager(testTempDir, mergeTimeout);
  });

  afterEach(async () => {
    // Очищаем тестовую директорию
    try {
      await fs.rm(testTempDir, { recursive: true, force: true });
    } catch (error) {
      // Игнорируем ошибки
    }
  });

  describe('initialize', () => {
    it('должен создать директорию для временных файлов', async () => {
      await fileManager.initialize();
      
      const stats = await fs.stat(testTempDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('generateFilePath', () => {
    it('должен генерировать уникальный путь к файлу', () => {
      const videoId = 'test123';
      const extension = 'mp4';
      
      const filePath = fileManager.generateFilePath(videoId, extension);
      
      expect(filePath).toContain(videoId);
      expect(filePath).toContain(extension);
      // Проверяем что путь содержит testTempDir (нормализованный)
      expect(path.normalize(filePath)).toContain(path.normalize(testTempDir));
    });

    it('должен генерировать разные пути при повторных вызовах', (done) => {
      const videoId = 'test123';
      const extension = 'mp4';
      
      const path1 = fileManager.generateFilePath(videoId, extension);
      
      // Ждем 1мс чтобы timestamp изменился
      setTimeout(() => {
        const path2 = fileManager.generateFilePath(videoId, extension);
        expect(path1).not.toBe(path2);
        done();
      }, 2);
    });
  });

  describe('checkFfmpegAvailable', () => {
    it('должен проверить доступность ffmpeg', async () => {
      const available = await fileManager.checkFfmpegAvailable();
      
      expect(typeof available).toBe('boolean');
    });
  });

  describe('deleteFile', () => {
    it('должен удалить файл', async () => {
      await fileManager.initialize();
      
      const testFile = path.join(testTempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');
      
      await fileManager.deleteFile(testFile);
      
      await expect(fs.access(testFile)).rejects.toThrow();
    });

    it('не должен выбрасывать ошибку если файл не существует', async () => {
      const nonExistentFile = path.join(testTempDir, 'nonexistent.txt');
      
      await expect(fileManager.deleteFile(nonExistentFile)).resolves.not.toThrow();
    });
  });
});
