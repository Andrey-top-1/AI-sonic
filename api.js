const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

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
      console.log('Python stdout:', data.toString());
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
            resolve(JSON.parse(result));
          } else {
            resolve({});
          }
        } catch (e) {
          console.error('Error parsing Python response:', e);
          resolve({ success: false, message: 'Invalid response from Python' });
        }
      } else {
        reject(new Error(error || `Python process exited with code ${code}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python process:', err);
      reject(new Error('Python process failed to start'));
    });
  });
}

// API Routes с улучшенной обработкой ошибок
app.post('/api/register', async (req, res) => {
  try {
    console.log('Register request:', req.body);
    const { phone, name, birth_date, password } = req.body;
    
    if (!phone || !name || !birth_date || !password) {
      return res.status(400).json({
        success: false,
        message: 'Все поля обязательны для заполнения'
      });
    }

    const result = await callPythonScript('app.py', {
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
    console.log('Login request:', req.body);
    const { phone, password } = req.body;
    
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Номер телефона и пароль обязательны'
      });
    }

    const result = await callPythonScript('app.py', {
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
    console.log('Send message request:', req.body);
    const { user_data, message } = req.body;
    
    if (!user_data || !message) {
      return res.status(400).json({
        success: false,
        message: 'Данные пользователя и сообщение обязательны'
      });
    }

    const result = await callPythonScript('app.py', {
      action: 'send_message',
      user_data, message
    });
    
    res.json(result);
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
    console.log('Chat history request:', req.body);
    const { user_data } = req.body;
    
    if (!user_data) {
      return res.status(400).json({
        success: false,
        message: 'Данные пользователя обязательны'
      });
    }

    const result = await callPythonScript('app.py', {
      action: 'get_chat_history',
      user_data
    });
    
    res.json(result);
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
    console.log('TTS request:', req.body);
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Текст обязателен'
      });
    }

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
      res.send(audioBuffer);
    } else {
      res.status(500).json(result);
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
    console.log('Create payment request:', req.body);
    const { plan } = req.body;
    
    const result = await callPythonScript('app.py', {
      action: 'create_payment',
      plan: plan || 'basic'
    });
    
    res.json(result);
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

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    message: 'Внутренняя ошибка сервера'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dream Interpreter server running on port ${PORT}`);
  console.log(`📍 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
