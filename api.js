const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Функция для вызова Python скриптов
function callPythonScript(scriptName, args = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Calling Python script: ${scriptName} with args:`, args);
    
    const pythonProcess = spawn('python3', [
      path.join(__dirname, scriptName),
      JSON.stringify(args)
    ]);

    let result = '';
    let error = '';

    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
      console.error('Python stderr:', data.toString());
    });

    pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}`);
      if (code === 0) {
        try {
          if (result.trim()) {
            const parsedResult = JSON.parse(result);
            resolve(parsedResult);
          } else {
            resolve({ success: false, message: 'Empty response from Python' });
          }
        } catch (e) {
          console.error('Error parsing Python response:', e);
          resolve({ success: false, message: 'Invalid JSON response from Python' });
        }
      } else {
        reject(new Error(error || `Python process exited with code ${code}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python process:', err);
      reject(new Error('Python process failed to start: ' + err.message));
    });
  });
}

// Simple in-memory database for demo (since Python integration is problematic)
class SimpleDB {
  constructor() {
    this.users = new Map();
    this.chats = new Map();
    this.messages = new Map();
    this.initDemoData();
  }

  initDemoData() {
    // Demo user
    this.users.set('2', {
      id: '1',
      phone: '2',
      name: 'Demo User',
      birth_date: '2000-01-01',
      password: '222222',
      created_at: new Date().toISOString()
    });

    // Demo chat
    this.chats.set('1', {
      id: '1',
      user_id: '1',
      chat_type: 'web',
      created_at: new Date().toISOString()
    });
  }

  createUser(phone, name, birth_date, password) {
    const id = Date.now().toString();
    const user = {
      id,
      phone,
      name,
      birth_date,
      password,
      created_at: new Date().toISOString()
    };
    this.users.set(phone, user);
    return id;
  }

  getUserByPhone(phone) {
    return this.users.get(phone);
  }

  getOrCreateChat(user_id, chat_type = 'web') {
    const chatId = '1'; // Simple demo - one chat per user
    if (!this.chats.has(chatId)) {
      this.chats.set(chatId, {
        id: chatId,
        user_id,
        chat_type,
        created_at: new Date().toISOString()
      });
    }
    return chatId;
  }

  saveMessage(chat_id, role, content) {
    const messageId = Date.now().toString();
    if (!this.messages.has(chat_id)) {
      this.messages.set(chat_id, []);
    }
    this.messages.get(chat_id).push({
      id: messageId,
      chat_id,
      role,
      content,
      timestamp: new Date().toISOString()
    });
  }

  getChatHistory(chat_id, limit = 10) {
    const messages = this.messages.get(chat_id) || [];
    return messages.slice(-limit);
  }
}

// Initialize simple database
const simpleDB = new SimpleDB();

// AI Service using direct API call (no Python)
class AIService {
  constructor() {
    this.apiKey = "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";
    this.apiUrl = "https://openrouter.ai/api/v1/chat/completions";
  }

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

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://dream-interpreter.com",
          "X-Title": "ИИ Сонник"
        },
        body: JSON.stringify({
          "model": "deepseek/deepseek-chat-v3-0324",
          "messages": messages,
          "max_tokens": 1000
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices[0].message.content;
      } else {
        console.error('OpenRouter API error:', response.status);
        return this.getFallbackResponse(userData);
      }
    } catch (error) {
      console.error('AI API error:', error);
      return this.getFallbackResponse(userData);
    }
  }

  createSystemPrompt(userData) {
    const age = this.calculateAge(userData.birth_date);
    return `Ты - опытный психолог-толкователь снов. Твоя задача - анализировать сны и давать психологическую интерпретацию.

Информация о пользователе:
- Имя: ${userData.name}
- Возраст: ${age} лет

Твои особенности:
1. Давай развернутые, но понятные объяснения
2. Будь внимательным к деталям снов
3. Делай акцент на психологической интерпретации
4. Будь эмпатичным и поддерживающим
5. Учитывай контекст предыдущих бесед

Помни: сны - это способ подсознания общаться с нами. Твоя цель - помочь пользователю лучше понять себя.`;
  }

  calculateAge(birthDateStr) {
    try {
      if (!birthDateStr) return 0;
      const birthDate = new Date(birthDateStr);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      
      return age;
    } catch {
      return 0;
    }
  }

  getFallbackResponse(userData) {
    const responses = [
      "Интересный сон! На основе анализа тысяч сновидений, могу сказать, что такой сон часто связан с эмоциональным состоянием. Возможно, вы переживаете о чем-то или испытываете внутреннее напряжение.",
      "Толкование вашего сна указывает на внутренние переживания или нерешенные вопросы. Это может быть отражением вашего подсознания, которое пытается обработать дневные впечатления.",
      "Согласно сонникам, подобные сны часто связаны с поиском себя или своего места в жизни. Возможно, вам стоит обратить внимание на текущие цели и приоритеты.",
      `Учитывая ваш возраст (${this.calculateAge(userData.birth_date)} лет) и предыдущие обсуждения, этот сон может отражать скрытые желания или страхи, которые требуют внимания.`,
      "Интерпретация такого сна обычно связана с переменами, которые происходят или скоро произойдут в вашей жизни. Будьте открыты новым возможностям.",
      "Этот сон может быть отражением вашего творческого потенциала или нереализованных идей. Возможно, пришло время выразить себя в каком-то новом качестве."
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

const aiService = new AIService();

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

    // Check if user already exists
    if (simpleDB.getUserByPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь с таким номером телефона уже существует'
      });
    }

    // Create user
    const userId = simpleDB.createUser(phone, name, birth_date, password);
    
    res.json({
      success: true,
      message: 'Регистрация прошла успешно!',
      user_id: userId
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка регистрации' 
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

    const user = simpleDB.getUserByPhone(phone);
    
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
      res.status(401).json({
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

    const user = simpleDB.getUserByPhone(user_data.phone);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    const chatId = simpleDB.getOrCreateChat(user.id, 'web');
    simpleDB.saveMessage(chatId, 'user', message);
    
    const chatHistory = simpleDB.getChatHistory(chatId);
    const aiResponse = await aiService.getAIResponse(message, user, chatHistory);
    
    simpleDB.saveMessage(chatId, 'assistant', aiResponse);
    
    res.json({
      success: true,
      response: aiResponse
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка отправки сообщения' 
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

    const user = simpleDB.getUserByPhone(user_data.phone);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    const chatId = simpleDB.getOrCreateChat(user.id, 'web');
    const history = simpleDB.getChatHistory(chatId);
    
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

app.post('/api/text-to-speech', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Текст обязателен'
      });
    }

    // Use browser's Web Speech API on client side
    res.json({
      success: false,
      message: 'Используйте озвучку в браузере (кнопка динамика)'
    });
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка озвучки' 
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
    
    const planData = plans[plan] || plans.basic;
    
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
});
