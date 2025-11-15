const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// Функция для вызова Python скриптов
function callPythonScript(scriptName, args = {}) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', [
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
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    resolve(JSON.parse(result));
                } catch (e) {
                    resolve(result);
                }
            } else {
                reject(new Error(error || `Python process exited with code ${code}`));
            }
        });
    });
}

// API Routes
app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, birth_date, password } = req.body;
        const result = await callPythonScript('app.py', {
            action: 'register',
            phone, name, birth_date, password
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка регистрации: ' + error.message 
        });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const result = await callPythonScript('app.py', {
            action: 'login',
            phone, password
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка входа: ' + error.message 
        });
    }
});

app.post('/api/send-message', async (req, res) => {
    try {
        const { user_data, message } = req.body;
        const result = await callPythonScript('app.py', {
            action: 'send_message',
            user_data, message
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка отправки сообщения: ' + error.message 
        });
    }
});

app.post('/api/chat-history', async (req, res) => {
    try {
        const { user_data } = req.body;
        const result = await callPythonScript('app.py', {
            action: 'get_chat_history',
            user_data
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка загрузки истории: ' + error.message 
        });
    }
});

app.post('/api/text-to-speech', async (req, res) => {
    try {
        const { text } = req.body;
        const result = await callPythonScript('app.py', {
            action: 'text_to_speech',
            text
        });
        
        if (result.success && result.audio) {
            // Конвертируем base64 аудио в бинарные данные
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
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка озвучки: ' + error.message 
        });
    }
});

app.post('/api/create-payment', async (req, res) => {
    try {
        const { plan } = req.body;
        const result = await callPythonScript('app.py', {
            action: 'create_payment',
            plan
        });
        res.json(result);
    } catch (error) {
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

app.listen(PORT, () => {
    console.log(`Dream Interpreter server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});
