const express = require('express');
const cors = require('cors');
const path = require('path');

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

// База данных в памяти
const memoryDB = {
  users: [],
  messages: [],
  chats: []
};

// Генератор ID
function generateId() {
  return Date.now() + Math.random().toString(36).substr(2, 9);
}

// AI ответы
const aiResponses = [
  "Интересный сон! На основе психологического анализа, такой сон часто связан с эмоциональным состоянием. Возможно, вы переживаете о чем-то или испытываете внутреннее напряжение.",
  "Толкование вашего сна указывает на внутренние переживания или нерешенные вопросы. Это может быть отражением вашего подсознания, которое пытается обработать дневные впечатления.",
  "Согласно сонникам, подобные сны часто связаны с поиском себя или своего места в жизни. Возможно, вам стоит обратить внимание на текущие цели и приоритеты.",
  "Этот сон может быть отражением вашего творческого потенциала или нереализованных идей. Возможно, пришло время выразить себя в каком-то новом качестве.",
  "Интерпретация такого сна обычно связана с переменами, которые происходят или скоро произойдут в вашей жизни. Будьте открыты новым возможностям.",
  "Ваш сон может символизировать скрытые страхи или желания. Попробуйте проанализировать, что вызывает у вас подобные эмоции в реальной жизни.",
  "С психологической точки зрения, такой сон часто связан с потребностью в безопасности и стабильности. Обратите внимание на области жизни, где вы чувствуете неуверенность.",
  "Этот сон может указывать на необходимость отдыха и восстановления сил. Ваше подсознание сигнализирует о переутомлении."
];

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
    const existingUser = memoryDB.users.find(u => u.phone === phone);
    if (existingUser) {
      return res.json({
        success: false,
        message: 'Пользователь с таким номером телефона уже существует'
      });
    }

    const newUser = {
      id: generateId(),
      phone,
      name,
      birth_date,
      password,
      created_at: new Date().toISOString()
    };
    
    memoryDB.users.push(newUser);
    
    // Создаем чат для пользователя
    const newChat = {
      id: generateId(),
      user_id: newUser.id,
      chat_type: 'web',
      created_at: new Date().toISOString()
    };
    memoryDB.chats.push(newChat);
    
    res.json({
      success: true,
      message: 'Регистрация прошла успешно!',
      user_id: newUser.id
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

    const user = memoryDB.users.find(u => u.phone === phone && u.password === password);
    
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
    const user = memoryDB.users.find(u => u.id === user_data.id);
    if (!user) {
      return res.json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    // Находим или создаем чат
    let chat = memoryDB.chats.find(c => c.user_id === user.id && c.chat_type === 'web');
    if (!chat) {
      chat = {
        id: generateId(),
        user_id: user.id,
        chat_type: 'web',
        created_at: new Date().toISOString()
      };
      memoryDB.chats.push(chat);
    }

    // Сохраняем сообщение пользователя
    const userMessage = {
      id: generateId(),
      chat_id: chat.id,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };
    memoryDB.messages.push(userMessage);

    // Генерируем ответ AI
    const randomResponse = aiResponses[Math.floor(Math.random() * aiResponses.length)];
    
    // Добавляем персонализацию
    let response = randomResponse;
    if (user.name) {
      response = response.replace('ваш', `ваш, ${user.name}`);
    }

    // Сохраняем ответ AI
    const aiMessage = {
      id: generateId(),
      chat_id: chat.id,
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString()
    };
    memoryDB.messages.push(aiMessage);

    res.json({
      success: true,
      response: response
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
    const user = memoryDB.users.find(u => u.id === user_data.id);
    if (!user) {
      return res.json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    // Находим чат пользователя
    const chat = memoryDB.chats.find(c => c.user_id === user.id && c.chat_type === 'web');
    if (!chat) {
      return res.json({
        success: true,
        history: []
      });
    }

    // Получаем историю сообщений
    const history = memoryDB.messages
      .filter(m => m.chat_id === chat.id)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-10);

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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dream Interpreter server running on port ${PORT}`);
  console.log(`📍 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`💾 Using in-memory database`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
