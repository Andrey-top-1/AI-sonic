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
    
    // Пробуем разные варианты запуска Python
    const pythonCommands = ['python3', 'python'];
    let pythonProcess = null;
    let lastError = null;

    for (const cmd of pythonCommands) {
      try {
        pythonProcess = spawn(cmd, [
          path.join(__dirname, scriptName),
          JSON.stringify(args)
        ]);
        console.log(`Using Python command: ${cmd}`);
        break;
      } catch (error) {
        lastError = error;
        console.log(`Python command ${cmd} failed, trying next...`);
      }
    }

    if (!pythonProcess) {
      reject(new Error(`No Python interpreter found. Tried: ${pythonCommands.join(', ')}`));
      return;
    }

    let result = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
      console.log('Python stdout:', data.toString());
    });

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
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
            resolve({});
          }
        } catch (e) {
          console.error('Error parsing Python response:', e);
          resolve({ 
            success: false, 
            message: 'Invalid JSON response from Python',
            rawResponse: result 
          });
        }
      } else {
        reject(new Error(errorOutput || `Python process exited with code ${code}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python process:', err);
      reject(new Error(`Python process failed to start: ${err.message}`));
    });

    // Таймаут для Python процесса
    setTimeout(() => {
      if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill();
        reject(new Error('Python process timeout'));
      }
    }, 30000);
  });
}

// Простая эмуляция базы данных в памяти для демо
const memoryDB = {
  users: [],
  messages: []
};

// API Routes с fallback на JavaScript реализацию
app.post('/api/register', async (req, res) => {
  try {
    const { phone, name, birth_date, password } = req.body;
    
    if (!phone || !name || !birth_date || !password) {
      return res.status(400).json({
        success: false,
        message: 'Все поля обязательны для заполнения'
      });
    }

    // Сначала пробуем Python
    try {
      const result = await callPythonScript('app.py', {
        action: 'register',
        phone, name, birth_date, password
      });
      return res.json(result);
    } catch (pythonError) {
      console.log('Python failed, using JavaScript fallback:', pythonError.message);
      
      // Fallback на JavaScript реализацию
      const existingUser = memoryDB.users.find(u => u.phone === phone);
      if (existingUser) {
        return res.json({
          success: false,
          message: 'Пользователь с таким номером телефона уже существует'
        });
      }

      const newUser = {
        id: Date.now(),
        phone,
        name,
        birth_date,
        password,
        created_at: new Date().toISOString()
      };
      
      memoryDB.users.push(newUser);
      
      return res.json({
        success: true,
        message: 'Регистрация прошла успешно! (JS Fallback)',
        user_id: newUser.id
      });
    }
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

    // Сначала пробуем Python
    try {
      const result = await callPythonScript('app.py', {
        action: 'login',
        phone, password
      });
      return res.json(result);
    } catch (pythonError) {
      console.log('Python failed, using JavaScript fallback:', pythonError.message);
      
      // Fallback на JavaScript реализацию
      const user = memoryDB.users.find(u => u.phone === phone && u.password === password);
      
      if (user) {
        return res.json({
          success: true,
          message: 'Вход выполнен успешно! (JS Fallback)',
          user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            birth_date: user.birth_date
          }
        });
      } else {
        return res.json({
          success: false,
          message: 'Неверный номер телефона или пароль'
        });
      }
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

    // Сначала пробуем Python
    try {
      const result = await callPythonScript('app.py', {
        action: 'send_message',
        user_data, message
      });
      return res.json(result);
    } catch (pythonError) {
      console.log('Python failed, using JavaScript fallback:', pythonError.message);
      
      // Fallback на JavaScript реализацию
      const responses = [
        "Интересный сон! На основе анализа могу сказать, что такой сон часто связан с эмоциональным состоянием.",
        "Толкование вашего сна указывает на внутренние переживания или нерешенные вопросы.",
        "Согласно сонникам, подобные сны часто связаны с поиском себя или своего места в жизни.",
        "Этот сон может быть отражением вашего творческого потенциала или нереализованных идей.",
        "Интерпретация такого сна обычно связана с переменами, которые происходят в вашей жизни."
      ];
      
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      
      // Сохраняем сообщение в памяти
      memoryDB.messages.push({
        user_id: user_data.id,
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      });
      
      memoryDB.messages.push({
        user_id: user_data.id,
        role: 'assistant',
        content: randomResponse,
        timestamp: new Date().toISOString()
      });
      
      return res.json({
        success: true,
        response: randomResponse + " (JS Fallback)"
      });
    }
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

    // Сначала пробуем Python
    try {
      const result = await callPythonScript('app.py', {
        action: 'get_chat_history',
        user_data
      });
      return res.json(result);
    } catch (pythonError) {
      console.log('Python failed, using JavaScript fallback:', pythonError.message);
      
      // Fallback на JavaScript реализацию
      const userMessages = memoryDB.messages.filter(m => m.user_id === user_data.id);
      
      return res.json({
        success: true,
        history: userMessages.slice(-10) // Последние 10 сообщений
      });
    }
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

    // Сначала пробуем Python
    try {
      const result = await callPythonScript('app.py', {
        action: 'text_to_speech',
        text
      });
      
      if (result.success && result.audio) {
        const audioBuffer = Buffer.from(result.audio, 'base64');
        res.set({
          'Content-Type': 'audio/mpeg',
          'Content-Length': audioBuffer.length
        });
        return res.send(audioBuffer);
      } else {
        return res.status(500).json(result);
      }
    } catch (pythonError) {
      console.log('Python TTS failed:', pythonError.message);
      
      // Fallback: возвращаем ошибку, чтобы фронтенд использовал Web Speech API
      return res.status(500).json({
        success: false,
        message: 'Используйте встроенную озвучку браузера'
      });
    }
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
    
    // Всегда используем JavaScript реализацию для платежей
    const plans = {
      'basic': { price: '299', name: 'Базовый' },
      'premium': { price: '799', name: 'Премиум' }
    };
    
    const planData = plans[plan] || plans['basic'];
    
    return res.json({
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
  console.log(`🐍 Python support: ${typeof spawn === 'function' ? 'Available' : 'Not available'}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
