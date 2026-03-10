const fs = require("fs");
const readline = require("readline");

// Асинхронный вопрос пользователю
function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(question, ans => {
        rl.close();
        resolve(ans.trim().toLowerCase());
    }));
}

// Загружает многострочные блоки с разделителем ---
function loadBlocks(path) {
    if (!fs.existsSync(path)) return [];

    const lines = fs.readFileSync(path, "utf8")
        .split("\n")
        .map(line => line.trim());

    const blocks = [];
    let buffer = [];

    for (const line of lines) {
        if (line === "---") {
            const text = buffer.join(" ").trim();
            if (text.length > 0) blocks.push(text);
            buffer = [];
        } else {
            buffer.push(line);
        }
    }

    return blocks;
}

// Добавляет новые строки в конец, избегая дублей
function mergeCategory(oldList, newLines) {
    const existingTexts = new Set(oldList.map(item => item.text));
    const merged = [...oldList];

    for (const line of newLines) {
        if (!existingTexts.has(line)) {
            merged.push({ id: merged.length + 1, text: line });
        }
    }

    return merged;
}

async function main() {
    const outputFile = "jokes.json";

    // Базовая структура с описаниями
    let data = {
        short_dark_jokes_description: "Короткие шутки в стиле черный юмор. Многострочные. Разделяются в TXT через ---",
        short_dark_jokes: [],

        dark_anecdotes_description: "Длинные анекдоты в стиле черный юмор. Многострочные. Разделяются в TXT через ---",
        dark_anecdotes: [],

        dark_memes_description: "Мемы, однострочные или многострочные в стиле черный юмор. Разделяются в TXT через ---",
        dark_memes: []
    };

    // Если jokes.json существует — спрашиваем, можно ли обновлять
    if (fs.existsSync(outputFile)) {
        console.log(`⚠️ Файл ${outputFile} найден.`);

        const ans = await ask("Обновить существующий файл? (y/n): ");
        if (ans !== "y") {
            console.log("Операция отменена.");
            process.exit(0);
        }

        const backup = `jokes_backup_${Date.now()}.json`;
        fs.copyFileSync(outputFile, backup);
        console.log(`Создана резервная копия: ${backup}`);

        // Загружаем старые данные
        data = JSON.parse(fs.readFileSync(outputFile, "utf8"));

        // Добавляем описания, если их нет
        if (!data.short_dark_jokes_description)
            data.short_dark_jokes_description = "Короткие шутки в стиле черный юмор. Многострочные. Разделяются в TXT через ---";

        if (!data.dark_anecdotes_description)
            data.dark_anecdotes_description = "Длинные анекдоты в стиле черный юмор. Многострочные. Разделяются в TXT через ---";

        if (!data.dark_memes_description)
            data.dark_memes_description = "Мемы, однострочные или многострочные в стиле черный юмор. Разделяются в TXT через ---";
    }

    // Загружаем многострочные блоки из TXT
    const shortNew = loadBlocks("short.txt");
    const anecdotesNew = loadBlocks("anecdotes.txt");
    const memesNew = loadBlocks("memes.txt");

    // Мерджим категории
    data.short_dark_jokes = mergeCategory(data.short_dark_jokes, shortNew);
    data.dark_anecdotes = mergeCategory(data.dark_anecdotes, anecdotesNew);
    data.dark_memes = mergeCategory(data.dark_memes, memesNew);

    // Перенумеровываем ID
    data.short_dark_jokes = data.short_dark_jokes.map((item, i) => ({ id: i + 1, text: item.text }));
    data.dark_anecdotes = data.dark_anecdotes.map((item, i) => ({ id: i + 1, text: item.text }));
    data.dark_memes = data.dark_memes.map((item, i) => ({ id: i + 1, text: item.text }));

    // Сохраняем
    fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), "utf8");

    console.log("🎉 Готово! jokes.json обновлён.");
}

main();