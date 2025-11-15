const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// OpenRouter API конфигурация
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "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";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Инициализация базы данных
let db;

async function initializeDatabase() {
  try {
    db = await open({
      filename: './dream_interpreter.db',
      driver: sqlite3.Database
    });

    // Создаем таблицы если они не существуют
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        birth_date TEXT NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        chat_type TEXT NOT NULL,
        telegram_chat_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (chat_id) REFERENCES chats (id)
      )
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Проверяем соединение с базой данных
    await db.get('SELECT 1 as test');
    
    res.status(200).json({ 
      status: 'OK', 
      message: 'Server and database are running',
      timestamp: new Date().toISOString(),
      database: 'Connected'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Database connection failed',
      timestamp: new Date().toISOString(),
      database: 'Disconnected'
    });
  }
});

// Функция для расчета возраста
function calculateAge(birthDate) {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  
  return age;
}

// Функция для создания системного промпта
function createSystemPrompt(user) {
  const age = calculateAge(user.birth_date);
  
  return `Ты - опытный психолог-толкователь снов. Твоя задача - анализировать сны и давать психологическую интерпретацию.

Информация о пользователе:
- Имя: ${user.name}
- Возраст: ${age} лет

Твои особенности:
1. Давай развернутые, но понятные объяснения (3-5 предложений)
2. Будь внимательным к деталям снов
3. Делай акцент на психологической интерпретации
4. Будь эмпатичным и поддерживающим
5. Учитывай контекст предыдущих бесед
6. Используй профессиональную, но доступную лексику
7. Связывай интерпретацию с возможными жизненными ситуациями пользователя

Помни: сны - это способ подсознания общаться с нами. Твоя цель - помочь пользователю лучше понять себя через анализ сновидений.`;
}

// Функция для получения ответа от AI
async function getAIResponse(userMessage, user, chatHistory) {
  try {
    const systemPrompt = createSystemPrompt(user);
    
    // Формируем массив сообщений для AI
    const messages = [
      { role: "system", content: systemPrompt }
    ];

    // Добавляем историю чата (последние 6 сообщений для контекста)
    const recentHistory = chatHistory.slice(-6);
    recentHistory.forEach(msg => {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    });

    // Добавляем текущее сообщение пользователя
    messages.push({ role: "user", content: userMessage });

    console.log('Sending to AI:', {
      model: "deepseek/deepseek-chat-v3-0324",
      messageCount: messages.length,
      hasHistory: recentHistory.length > 0
    });

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://dream-interpreter.com',
        'X-Title': 'ИИ Сонник'
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324",
        messages: messages,
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content;
    } else {
      console.error('Unexpected API response:', data);
      throw new Error('Invalid API response format');
    }
  } catch (error) {
    console.error('AI API error:', error);
    
    // Fallback ответы
    const fallbackResponses = [
      "На основе анализа вашего сна, могу предположить, что он отражает ваше текущее эмоциональное состояние. Часто такие сны связаны с нерешёнными вопросами или внутренними переживаниями.",
      "Интерпретация вашего сна указывает на возможные скрытые тревоги или невыраженные эмоции. Ваше подсознание пытается обработать дневные впечатления.",
      "С психологической точки зрения, такой сон может быть связан с поиском баланса в жизни. Обратите внимание на области, где вы чувствуете напряжение.",
      "Ваш сон может символизировать переходный период в жизни. Подсознание часто использует образы снов для обработки значимых изменений.",
      "Анализ вашего сна suggests возможную потребность в самовыражении или творческой реализации. Рассмотрите новые способы проявления своих талантов."
    ];
    
    return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)] + " (Ответ сгенерирован локально)";
  }
}

// API Routes
app.post('/api/register', async (req, res) => {
  try {
    const { phone, name, birth_date, password } = req.body;
    
    if (!phone || !name || !birth_date || !password) {
      return res.status(400).json({
        success: false,
        message: 'Все поля обязательны для заполнения'
      });
    }

    // Проверка на существующего пользователя
    const existingUser = await db.get(
      'SELECT id FROM users WHERE phone = ?',
      [phone]
    );

    if (existingUser) {
      return res.json({
        success: false,
        message: 'Пользователь с таким номером телефона уже существует'
      });
    }

    // Создаем нового пользователя
    const result = await db.run(
      `INSERT INTO users (phone, name, birth_date, password, created_at) 
       VALUES (?, ?, ?, ?, ?)`,
      [phone, name, birth_date, password, new Date().toISOString()]
    );

    const userId = result.lastID;

    // Создаем чат для пользователя
    await db.run(
      `INSERT INTO chats (user_id, chat_type, created_at) 
       VALUES (?, ?, ?)`,
      [userId, 'web', new Date().toISOString()]
    );
    
    res.json({
      success: true,
      message: 'Регистрация прошла успешно!',
      user_id: userId
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка регистрации: ' + error.message 
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

    const user = await db.get(
      'SELECT id, phone, name, birth_date, password, created_at FROM users WHERE phone = ? AND password = ?',
      [phone, password]
    );
    
    if (user) {
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
      message: 'Ошибка входа: ' + error.message 
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

    // Находим пользователя
    const user = await db.get(
      'SELECT id, phone, name, birth_date FROM users WHERE id = ?',
      [user_data.id]
    );

    if (!user) {
      return res.json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    // Находим или создаем чат
    let chat = await db.get(
      'SELECT id FROM chats WHERE user_id = ? AND chat_type = ?',
      [user.id, 'web']
    );

    if (!chat) {
      const chatResult = await db.run(
        'INSERT INTO chats (user_id, chat_type, created_at) VALUES (?, ?, ?)',
        [user.id, 'web', new Date().toISOString()]
      );
      chat = { id: chatResult.lastID };
    }

    // Сохраняем сообщение пользователя
    await db.run(
      `INSERT INTO messages (chat_id, role, content, timestamp) 
       VALUES (?, ?, ?, ?)`,
      [chat.id, 'user', message, new Date().toISOString()]
    );

    // Получаем историю чата для контекста
    const chatHistory = await db.all(
      `SELECT role, content, timestamp 
       FROM messages 
       WHERE chat_id = ? 
       ORDER BY timestamp ASC`,
      [chat.id]
    );

    console.log('Chat history length:', chatHistory.length);

    // Получаем ответ от AI
    const aiResponse = await getAIResponse(message, user, chatHistory);

    // Сохраняем ответ AI
    await db.run(
      `INSERT INTO messages (chat_id, role, content, timestamp) 
       VALUES (?, ?, ?, ?)`,
      [chat.id, 'assistant', aiResponse, new Date().toISOString()]
    );

    res.json({
      success: true,
      response: aiResponse
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка отправки сообщения: ' + error.message 
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

    // Находим пользователя
    const user = await db.get(
      'SELECT id FROM users WHERE id = ?',
      [user_data.id]
    );

    if (!user) {
      return res.json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    // Находим чат пользователя
    const chat = await db.get(
      'SELECT id FROM chats WHERE user_id = ? AND chat_type = ?',
      [user.id, 'web']
    );

    if (!chat) {
      return res.json({
        success: true,
        history: []
      });
    }

    // Получаем историю сообщений
    const history = await db.all(
      `SELECT role, content, timestamp 
       FROM messages 
       WHERE chat_id = ? 
       ORDER BY timestamp ASC`,
      [chat.id]
    );

    res.json({
      success: true,
      history: history
    });
  } catch (error) {
    console.error('Chat history error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка загрузки истории: ' + error.message 
    });
  }
});

app.post('/api/text-to-speech', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Текст обязателен'
      });
    }

    // Всегда возвращаем ошибку, чтобы фронтенд использовал Web Speech API
    res.status(500).json({
      success: false,
      message: 'Используйте встроенную озвучку браузера'
    });
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка озвучки: ' + error.message 
    });
  }
});

app.post('/api/create-payment', async (req, res) => {
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

// Инициализация и запуск сервера
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Dream Interpreter server running on port ${PORT}`);
      console.log(`📍 Health check: http://0.0.0.0:${PORT}/health`);
      console.log(`💾 SQLite database: Connected`);
      console.log(`🤖 AI API: ${OPENROUTER_API_KEY ? 'Configured' : 'Not configured'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Запуск сервера
startServer();
