const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

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
    console.log(`Calling Python script: ${scriptName} with args:`, JSON.stringify(args).substring(0, 200) + '...');
    
    const pythonProcess = spawn('python3', [
      path.join(__dirname, scriptName),
      JSON.stringify(args)
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8'
    });

    let result = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
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
          console.error('Raw response:', result);
          resolve({ 
            success: false, 
            message: 'Invalid JSON response from Python'
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
        reject(new Error('Python process timeout (30s)'));
      }
    }, 30000);
  });
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

    const result = await callPythonScript('web_app.py', {
      action: 'register',
      phone, name, birth_date, password
    });
    
    res.json(result);
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

    const result = await callPythonScript('web_app.py', {
      action: 'login',
      phone, password
    });
    
    res.json(result);
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

    console.log(`Sending message from user ${user_data.name}: ${message.substring(0, 100)}...`);
    
    const result = await callPythonScript('web_app.py', {
      action: 'send_message',
      user_data, 
      message
    });
    
    res.json(result);
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

    const result = await callPythonScript('web_app.py', {
      action: 'get_chat_history',
      user_data
    });
    
    res.json(result);
  } catch (error) {
    console.error('Chat history error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка загрузки истории' 
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
  console.log(`🐍 Python integration: Active`);
  console.log(`💾 SQLite database: dream_interpreter.db`);
});
