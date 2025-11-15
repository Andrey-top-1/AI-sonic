const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Конфигурация API
const OPENROUTER_API_KEY = "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";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Инициализация базы данных
class Database {
    constructor() {
        this.db = new sqlite3.Database('dream_interpreter.db', (err) => {
            if (err) {
                console.error('Error opening database:', err);
            } else {
                console.log('Connected to SQLite database');
                this.initDb();
            }
        });
    }

    initDb() {
        const queries = [
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT UNIQUE,
                name TEXT NOT NULL,
                birth_date TEXT,
                password TEXT,
                telegram_id TEXT UNIQUE,
                telegram_username TEXT,
                created_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                chat_type TEXT DEFAULT 'web',
                telegram_chat_id TEXT,
                created_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER,
                role TEXT,
                content TEXT,
                timestamp TEXT,
                FOREIGN KEY (chat_id) REFERENCES chats (id)
            )`
        ];

        queries.forEach(query => {
            this.db.run(query, (err) => {
                if (err) {
                    console.error('Error creating table:', err);
                }
            });
        });
    }

    createUser(phone, name, birth_date, password) {
        return new Promise((resolve, reject) => {
            const query = `INSERT INTO users (phone, name, birth_date, password, created_at) 
                          VALUES (?, ?, ?, ?, datetime('now'))`;
            this.db.run(query, [phone, name, birth_date, password], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        reject(new Error('Пользователь с таким номером телефона уже существует'));
                    } else {
                        reject(err);
                    }
                } else {
                    resolve({ id: this.lastID });
                }
            });
        });
    }

    getUserByPhone(phone) {
        return new Promise((resolve, reject) => {
            const query = `SELECT id, phone, name, birth_date, password, created_at 
                          FROM users WHERE phone = ?`;
            this.db.get(query, [phone], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    getOrCreateChat(userId, chatType = 'web', telegramChatId = null) {
        return new Promise((resolve, reject) => {
            // Сначала пытаемся найти существующий чат
            const findQuery = `SELECT id FROM chats WHERE user_id = ? AND chat_type = ?`;
            this.db.get(findQuery, [userId, chatType], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(row.id);
                } else {
                    // Создаем новый чат
                    const insertQuery = `INSERT INTO chats (user_id, chat_type, telegram_chat_id, created_at) 
                                        VALUES (?, ?, ?, datetime('now'))`;
                    this.db.run(insertQuery, [userId, chatType, telegramChatId], function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(this.lastID);
                        }
                    });
                }
            });
        });
    }

    saveMessage(chatId, role, content) {
        return new Promise((resolve, reject) => {
            const query = `INSERT INTO messages (chat_id, role, content, timestamp) 
                          VALUES (?, ?, ?, datetime('now'))`;
            this.db.run(query, [chatId, role, content], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }

    getChatHistory(chatId, limit = 10) {
        return new Promise((resolve, reject) => {
            const query = `SELECT role, content, timestamp 
                          FROM messages 
                          WHERE chat_id = ? 
                          ORDER BY timestamp ASC 
                          LIMIT ?`;
            this.db.all(query, [chatId, limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }
}

class AIService {
    async getAIResponse(userMessage, userData, chatHistory) {
        try {
            const systemPrompt = this.createSystemPrompt(userData);
            
            const messages = [
                { role: "system", content: systemPrompt },
                ...chatHistory.map(msg => ({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content
                })),
                { role: "user", content: userMessage }
            ];

            console.log(`Sending AI request with ${messages.length} messages`);

            const response = await fetch(OPENROUTER_API_URL, {
                method: 'POST',
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://dream-interpreter.com",
                    "X-Title": "Dream Interpreter"
                },
                body: JSON.stringify({
                    "model": "deepseek/deepseek-chat-v3-0324",
                    "messages": messages,
                    "max_tokens": 1000,
                    "temperature": 0.7
                })
            });

            if (response.ok) {
                const data = await response.json();
                return data.choices[0].message.content;
            } else {
                console.error('OpenRouter API error:', response.status);
                return "Извините, произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте еще раз.";
            }
        } catch (error) {
            console.error('AI API error:', error);
            return "Извините, сервис временно недоступен. Пожалуйста, попробуйте позже.";
        }
    }

    createSystemPrompt(userData) {
        const age = this.calculateAge(userData.birth_date || '2000-01-01');
        const name = userData.name || 'пользователь';
        
        return `Ты - опытный психолог-толкователь снов с 20-летним стажем. Твоя задача - анализировать сны и давать глубокую психологическую интерпретацию.

ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:
- Имя: ${name}
- Возраст: ${age} лет

ТВОИ ОСОБЕННОСТИ:
1. Анализируй сны с точки зрения психологии
2. Учитывай контекст предыдущих бесед
3. Давай развернутые, но понятные объяснения
4. Будь эмпатичным и поддерживающим
5. Предлагай практические рекомендации

ФОРМАТ ОТВЕТА:
1. Анализ основных символов
2. Психологическая интерпретация  
3. Связь с реальной жизнью
4. Практические рекомендации

Помни: ты помогаешь ${name} лучше понять себя через анализ снов.`;
    }

    calculateAge(birthDateStr) {
        try {
            const birthDate = new Date(birthDateStr);
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const monthDiff = today.getMonth() - birthDate.getMonth();
            
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
            
            return age;
        } catch {
            return "неизвестно";
        }
    }
}

// Инициализация сервисов
const db = new Database();
const aiService = new AIService();

// API Routes
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, birth_date, password } = req.body;
        
        if (!phone || !name || !birth_date || !password) {
            return res.status(400).json({
                success: false,
                message: 'Все поля обязательны для заполнения'
            });
        }

        const result = await db.createUser(phone, name, birth_date, password);
        
        res.json({
            success: true,
            message: 'Регистрация прошла успешно!',
            user_id: result.id
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Ошибка регистрации'
        });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        
        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                message: 'Номер телефона и пароль обязательны'
            });
        }

        const user = await db.getUserByPhone(phone);
        
        if (user && user.password === password) {
            res.json({
                success: true,
                message: 'Вход выполнен успешно!',
                user: {
                    id: user.id,
                    name: user.name,
                    phone: user.phone,
                    birth_date: user.birth_date
                }
            });
        } else {
            res.json({
                success: false,
                message: 'Неверный номер телефона или пароль'
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка входа'
        });
    }
});

app.post('/api/send-message', async (req, res) => {
    try {
        const { user_data, message } = req.body;
        
        if (!user_data || !message) {
            return res.status(400).json({
                success: false,
                message: 'Данные пользователя и сообщение обязательны'
            });
        }

        console.log(`Sending message from user ${user_data.name}: ${message.substring(0, 100)}...`);
        
        const user = await db.getUserByPhone(user_data.phone);
        if (!user) {
            return res.json({
                success: false,
                message: 'Пользователь не найден'
            });
        }

        // Получаем или создаем чат
        const chatId = await db.getOrCreateChat(user.id, 'web');
        
        // Сохраняем сообщение пользователя
        await db.saveMessage(chatId, 'user', message);
        
        // Получаем историю чата
        const chatHistory = await db.getChatHistory(chatId, 6);
        
        // Получаем ответ от AI
        const aiResponse = await aiService.getAIResponse(message, user, chatHistory);
        
        // Сохраняем ответ AI
        await db.saveMessage(chatId, 'assistant', aiResponse);
        
        res.json({
            success: true,
            response: aiResponse
        });
        
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Извините, произошла ошибка. Пожалуйста, попробуйте еще раз.' 
        });
    }
});

app.post('/api/chat-history', async (req, res) => {
    try {
        const { user_data } = req.body;
        
        if (!user_data) {
            return res.status(400).json({
                success: false,
                message: 'Данные пользователя обязательны'
            });
        }

        const user = await db.getUserByPhone(user_data.phone);
        if (!user) {
            return res.json({
                success: false,
                message: 'Пользователь не найден'
            });
        }

        const chatId = await db.getOrCreateChat(user.id, 'web');
        const history = await db.getChatHistory(chatId, 20);
        
        res.json({
            success: true,
            history: history
        });
    } catch (error) {
        console.error('Chat history error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка загрузки истории' 
        });
    }
});

app.post('/api/create-payment', (req, res) => {
    try {
        const { plan } = req.body;
        
        const plans = {
            'basic': { price: '299', name: 'Базовый' },
            'premium': { price: '799', name: 'Премиум' }
        };
        
        const planData = plans[plan] || plans['basic'];
        
        res.json({
            success: true,
            payment_url: '#',
            payment_data: {
                plan: plan,
                price: planData.price,
                name: planData.name
            }
        });
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка создания платежа' 
        });
    }
});

// Serve the main HTML file for all routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Dream Interpreter server running on port ${PORT}`);
    console.log(`📍 Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`💾 SQLite database: dream_interpreter.db`);
    console.log(`🤖 AI Service: Ready`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
