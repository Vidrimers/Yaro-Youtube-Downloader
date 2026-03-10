# Инструкция по деплою на сервер

## Быстрый старт на VPS (Ubuntu/Debian)

### 1. Подготовка сервера

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Установка ffmpeg
sudo apt install -y ffmpeg

# Установка Python и pip
sudo apt install -y python3 python3-pip

# Установка yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Проверка установки
node --version
ffmpeg -version
yt-dlp --version
```

### 2. Клонирование и настройка проекта

```bash
# Клонирование репозитория
cd ~
git clone https://github.com/yourusername/youtube-downloader-bot.git
cd youtube-downloader-bot

# Установка зависимостей
npm install

# Создание .env файла
cp .env.example .env
nano .env
```

### 3. Настройка .env

```env
TELEGRAM_BOT_TOKEN=ваш_токен_от_BotFather

# Опционально
ALLOWED_USERS=
MAX_VIDEO_DURATION=3600
NODE_ENV=production

# Настройки файлов
TEMP_DIR=./temp
MAX_FILE_SIZE=2147483648
DOWNLOAD_TIMEOUT=600000
MERGE_TIMEOUT=300000
```

### 4. Запуск с PM2

```bash
# Установка PM2
sudo npm install -g pm2

# Запуск бота
pm2 start bot.js --name youtube-bot

# Просмотр логов
pm2 logs youtube-bot

# Автозапуск при перезагрузке
pm2 startup
pm2 save

# Полезные команды PM2
pm2 status              # Статус процессов
pm2 restart youtube-bot # Перезапуск
pm2 stop youtube-bot    # Остановка
pm2 delete youtube-bot  # Удаление
```

### 5. Обновление бота

```bash
cd ~/youtube-downloader-bot

# Остановка бота
pm2 stop youtube-bot

# Обновление кода
git pull

# Установка новых зависимостей (если есть)
npm install

# Запуск бота
pm2 restart youtube-bot
```

### 6. Обслуживание

```bash
# Обновление yt-dlp (раз в неделю)
sudo yt-dlp -U

# Просмотр логов
pm2 logs youtube-bot --lines 100

# Очистка логов
pm2 flush youtube-bot

# Мониторинг
pm2 monit
```

## Настройка Nginx (опционально, для webhook)

Если планируете использовать webhook вместо polling:

```bash
# Установка Nginx
sudo apt install -y nginx

# Создание конфига
sudo nano /etc/nginx/sites-available/youtube-bot

# Добавить:
server {
    listen 80;
    server_name your-domain.com;

    location /webhook {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Активация конфига
sudo ln -s /etc/nginx/sites-available/youtube-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Мониторинг дискового пространства

```bash
# Проверка места
df -h

# Размер папки temp
du -sh ~/youtube-downloader-bot/temp

# Очистка старых файлов (если нужно)
find ~/youtube-downloader-bot/temp -type f -mtime +1 -delete
```

## Безопасность

```bash
# Настройка firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Создание отдельного пользователя для бота
sudo adduser botuser
sudo su - botuser
# Повторить шаги 2-4 от имени botuser
```

## Troubleshooting

### Бот не запускается

```bash
# Проверка логов
pm2 logs youtube-bot --err

# Проверка .env
cat .env

# Проверка зависимостей
npm install
```

### Ошибки ffmpeg

```bash
# Проверка установки
which ffmpeg
ffmpeg -version

# Переустановка
sudo apt remove ffmpeg
sudo apt install ffmpeg
```

### Ошибки yt-dlp

```bash
# Обновление
sudo yt-dlp -U

# Проверка
yt-dlp --version
yt-dlp "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --get-title
```

### Нехватка места на диске

```bash
# Очистка temp
rm -rf ~/youtube-downloader-bot/temp/*

# Очистка логов PM2
pm2 flush

# Очистка npm cache
npm cache clean --force
```

## Резервное копирование

```bash
# Создание бэкапа
cd ~
tar -czf youtube-bot-backup-$(date +%Y%m%d).tar.gz youtube-downloader-bot/

# Восстановление
tar -xzf youtube-bot-backup-20260310.tar.gz
```
