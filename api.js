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

// In-memory storage for demo purposes
let users = [];
let messages = [];
let chats = [];

// Helper functions
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

function generateAIResponse(message, user) {
  const responses = [
    "Интересный сон! На основе анализа тысяч сновидений, могу сказать, что такой сон часто связан с эмоциональным состоянием. Возможно, вы переживаете о чем-то или испытываете внутреннее напряжение.",
    "Толкование вашего сна указывает на внутренние переживания или нерешенные вопросы. Это может быть отражением вашего подсознания, которое пытается обработать дневные впечатления.",
    "Согласно сонникам, подобные сны часто связаны с поиском себя или своего места в жизни. Возможно, вам стоит обратить внимание на текущие цели и приоритеты.",
    `Учитывая ваш возраст (${calculateAge(user.birth_date)} лет) и предыдущие обсуждения, этот сон может отражать скрытые желания или страхи, которые требуют внимания.`,
    "Интерпретация такого сна обычно связана с переменами, которые происходят или скоро произойдут в вашей жизни. Будьте открыты новым возможностям.",
    "Этот сон может быть отражением вашего творческого потенциала или нереализованных идей. Возможно, пришло время выразить себя в каком-то новом качестве."
  ];

  let response = responses[Math.floor(Math.random() * responses.length)];
  if (user.name) {
    response = response.replace('ваш', `ваш, ${user.name}`);
  }

  return response;
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

    // Check if user already exists
    const existingUser = users.find(u => u.phone === phone);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь с таким номером телефона уже существует'
      });
    }

    // Create new user
    const newUser = {
      id: Date.now(),
      phone,
      name,
      birth_date,
      password,
      created_at: new Date().toISOString()
    };

    users.push(newUser);

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

    const user = users.find(u => u.phone === phone && u.password === password);
    
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
      res.status(400).json({
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

    const user = users.find(u => u.phone === user_data.phone);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    // Get or create chat
    let chat = chats.find(c => c.user_id === user.id && c.chat_type === 'web');
    if (!chat) {
      chat = {
        id: Date.now(),
        user_id: user.id,
        chat_type: 'web',
        created_at: new Date().toISOString()
      };
      chats.push(chat);
    }

    // Save user message
    const userMessage = {
      id: Date.now(),
      chat_id: chat.id,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };
    messages.push(userMessage);

    // Generate AI response
    const aiResponse = generateAIResponse(message, user);

    // Save AI message
    const aiMessage = {
      id: Date.now() + 1,
      chat_id: chat.id,
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date().toISOString()
    };
    messages.push(aiMessage);

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

    const user = users.find(u => u.phone === user_data.phone);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    const chat = chats.find(c => c.user_id === user.id && c.chat_type === 'web');
    if (!chat) {
      return res.json({ success: true, history: [] });
    }

    const history = messages
      .filter(m => m.chat_id === chat.id)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-10);

    res.json({ success: true, history });
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

    // For demo purposes, we'll return success but no audio
    // In a real application, you would use a TTS service
    res.json({
      success: false,
      message: 'Озвучка доступна только через браузерный Web Speech API'
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
      message: 'Ошибка создания платежа: ' + error.message 
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

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
