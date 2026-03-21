#!/bin/bash
###############################################################################
# ytdown.sh - Скрипт обновления ytdownload через Git
# Использование: ./ytdown.sh
###############################################################################

set -e  # Остановить при ошибке

echo "[DEPLOY] Переход в директорию сайта..."
cd /home/ytdownload || exit 1

echo "[DEPLOY] Обновляем код из Git..."
git pull origin master || exit 1

echo "[DEPLOY] Устанавливаем зависимости..."
npm install || exit 1

echo "[DEPLOY] Перезапускаем сервер через PM2..."
pm2 restart ytdownload || exit 1

echo "[DEPLOY] ✓ Обновление завершено успешно!"
echo "[DEPLOY] Проверить статус: pm2 status"
echo "[DEPLOY] Просмотреть логи: pm2 logs ytdownload"

exit 0
