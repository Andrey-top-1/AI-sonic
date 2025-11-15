from flask import Flask, render_template, request, jsonify, session, send_file
from database import Database
import requests
import json
import os
from datetime import datetime
import base64
from io import BytesIO
import tempfile
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-123')

db = Database()

# Конфигурация OpenRouter API
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "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")
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

class AIService:
    def __init__(self):
        self.api_key = OPENROUTER_API_KEY
        self.api_url = OPENROUTER_API_URL

    def get_ai_response(self, user_message: str, user_data: dict, chat_history: list) -> str:
        """Получение ответа от AI с учетом истории и данных пользователя"""
        
        # Создаем системный промпт с данными пользователя
        system_prompt = self._create_system_prompt(user_data)
        
        # Формируем сообщения для AI
        messages = [{"role": "system", "content": system_prompt}]
        
        # Добавляем историю чата (последние 6 сообщений для контекста)
        for msg in chat_history[-6:]:
            messages.append({
                "role": "user" if msg['role'] == 'user' else "assistant",
                "content": msg['content']
            })
        
        # Добавляем текущее сообщение пользователя
        messages.append({"role": "user", "content": user_message})
        
        try:
            response = requests.post(
                url=self.api_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://dream-interpreter.com",
                    "X-Title": "ИИ Сонник"
                },
                data=json.dumps({
                    "model": "deepseek/deepseek-chat-v3-0324",
                    "messages": messages,
                    "max_tokens": 1000
                }),
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                return data['choices'][0]['message']['content']
            else:
                logger.error(f"OpenRouter API error: {response.status_code} - {response.text}")
                return "Извините, произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте еще раз."
                
        except Exception as e:
            logger.error(f"AI API error: {e}")
            return "Извините, сервис временно недоступен. Пожалуйста, попробуйте позже."

    def _create_system_prompt(self, user_data: dict) -> str:
        """Создание системного промпта с данными пользователя"""
        age = self._calculate_age(user_data['birth_date'])
        
        return f"""Ты - опытный психолог-толкователь снов. Твоя задача - анализировать сны, которые описывают пользователи, и давать им психологическую интерпретацию.

Информация о пользователе:
- Имя: {user_data['name']}
- Возраст: {age} лет

Твои особенности:
1. Давай развернутые, но понятные объяснения (3-5 предложений)
2. Будь внимательным к деталям снов
3. Делай акцент на психологической интерпретации, а не эзотерике
4. Будь эмпатичным и поддерживающим
5. Учитывай контекст предыдущих бесед с пользователем
6. Помогай пользователю понять, что его подсознание пытается сообщить

Помни: сны - это способ подсознания общаться с нами. Твоя цель - помочь пользователю лучше понять себя через анализ сновидений."""

    def _calculate_age(self, birth_date_str: str) -> int:
        """Расчет возраста по дате рождения"""
        try:
            birth_date = datetime.strptime(birth_date_str, '%Y-%m-%d')
            today = datetime.now()
            age = today.year - birth_date.year
            
            if today.month < birth_date.month or (today.month == birth_date.month and today.day < birth_date.day):
                age -= 1
                
            return age
        except:
            return 0

class TTSService:
    """Сервис для преобразования текста в речь с использованием gTTS"""
    
    def __init__(self):
        try:
            from gtts import gTTS
            self.gTTS = gTTS
        except ImportError:
            logger.error("gTTS not available")
            self.gTTS = None
    
    def text_to_speech(self, text: str, lang: str = 'ru') -> BytesIO:
        """Преобразование текста в речь и возврат BytesIO с аудио"""
        if not self.gTTS:
            raise ImportError("gTTS не установлен")
            
        try:
            # Ограничиваем длину текста для TTS
            if len(text) > 500:
                text = text[:500] + "..."
                
            tts = self.gTTS(text=text, lang=lang, slow=False)
            audio_buffer = BytesIO()
            tts.write_to_fp(audio_buffer)
            audio_buffer.seek(0)
            return audio_buffer
        except Exception as e:
            logger.error(f"TTS error: {e}")
            raise Exception("Ошибка преобразования текста в речь")

class SpeechRecognitionService:
    """Сервис для распознавания речи"""
    
    def __init__(self):
        try:
            import speech_recognition as sr
            self.sr = sr
        except ImportError:
            logger.error("SpeechRecognition not available")
            self.sr = None
    
    def speech_to_text(self, audio_data: BytesIO) -> str:
        """Преобразование аудио в текст"""
        if not self.sr:
            raise ImportError("SpeechRecognition не установлен")
            
        try:
            recognizer = self.sr.Recognizer()
            
            # Сохраняем аудио во временный файл
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_audio:
                temp_audio.write(audio_data.read())
                temp_audio_path = temp_audio.name
            
            try:
                with self.sr.AudioFile(temp_audio_path) as source:
                    audio = recognizer.record(source)
                    text = recognizer.recognize_google(audio, language='ru-RU')
                    return text
            finally:
                # Удаляем временный файл
                if os.path.exists(temp_audio_path):
                    os.remove(temp_audio_path)
                    
        except self.sr.UnknownValueError:
            raise Exception("Не удалось распознать речь")
        except self.sr.RequestError as e:
            raise Exception(f"Ошибка сервиса распознавания: {e}")
        except Exception as e:
            logger.error(f"Speech recognition error: {e}")
            raise Exception("Ошибка при обработке аудио")

# Инициализация сервисов
ai_service = AIService()
tts_service = TTSService()
speech_service = SpeechRecognitionService()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/register', methods=['POST'])
def register():
    """Регистрация нового пользователя"""
    try:
        data = request.json
        
        # Валидация данных
        if not all([data.get('phone'), data.get('name'), data.get('birth_date'), data.get('password')]):
            return jsonify({
                'success': False,
                'message': 'Все поля обязательны для заполнения'
            }), 400
        
        user_id = db.create_user(
            phone=data['phone'],
            name=data['name'],
            birth_date=data['birth_date'],
            password=data['password']
        )
        
        # Автоматический вход после регистрации
        session['user_id'] = user_id
        session['user_phone'] = data['phone']
        
        return jsonify({
            'success': True,
            'message': 'Регистрация прошла успешно!',
            'user_id': user_id
        })
        
    except ValueError as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 400
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return jsonify({
            'success': False,
            'message': 'Произошла ошибка при регистрации'
        }), 500

@app.route('/api/login', methods=['POST'])
def login():
    """Вход пользователя"""
    try:
        data = request.json
        user = db.get_user_by_phone(data['phone'])
        
        if user and user['password'] == data['password']:
            session['user_id'] = user['id']
            session['user_phone'] = user['phone']
            
            return jsonify({
                'success': True,
                'message': 'Вход выполнен успешно!',
                'user': {
                    'id': user['id'],
                    'name': user['name'],
                    'phone': user['phone']
                }
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Неверный номер телефона или пароль'
            }), 401
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({
            'success': False,
            'message': 'Произошла ошибка при входе'
        }), 500

@app.route('/api/logout', methods=['POST'])
def logout():
    """Выход пользователя"""
    try:
        session.clear()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Logout error: {e}")
        return jsonify({'success': False}), 500

@app.route('/api/send_message', methods=['POST'])
def send_message():
    """Отправка сообщения и получение ответа от AI"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'Требуется авторизация'}), 401
        
        data = request.json
        user_message = data.get('message', '').strip()
        
        if not user_message:
            return jsonify({'error': 'Сообщение не может быть пустым'}), 400
        
        # Получаем пользователя
        user = db.get_user_by_phone(session['user_phone'])
        if not user:
            session.clear()
            return jsonify({'error': 'Пользователь не найден'}), 401
        
        # Получаем или создаем чат
        chat_id = db.get_or_create_chat(user['id'], 'web')
        
        # Сохраняем сообщение пользователя
        db.save_message(chat_id, 'user', user_message)
        
        # Получаем историю чата
        chat_history = db.get_chat_history(chat_id, limit=10)
        
        # Получаем ответ от AI
        ai_response = ai_service.get_ai_response(user_message, user, chat_history)
        
        # Сохраняем ответ AI
        db.save_message(chat_id, 'assistant', ai_response)
        
        return jsonify({
            'success': True,
            'response': ai_response,
            'chat_id': chat_id
        })
        
    except Exception as e:
        logger.error(f"Send message error: {e}")
        return jsonify({
            'success': False,
            'message': 'Произошла ошибка при отправке сообщения'
        }), 500

@app.route('/api/chat_history', methods=['GET'])
def get_chat_history():
    """Получение истории чата"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'Требуется авторизация'}), 401
        
        user = db.get_user_by_phone(session['user_phone'])
        if not user:
            session.clear()
            return jsonify({'error': 'Пользователь не найден'}), 401
            
        chat_id = db.get_or_create_chat(user['id'], 'web')
        history = db.get_chat_history(chat_id, limit=20)
        
        return jsonify({'success': True, 'history': history})
        
    except Exception as e:
        logger.error(f"Chat history error: {e}")
        return jsonify({'success': False, 'error': 'Ошибка загрузки истории'}), 500

@app.route('/api/text_to_speech', methods=['POST'])
def text_to_speech():
    """Преобразование текста в речь - возвращает аудио файл"""
    try:
        data = request.json
        text = data.get('text', '').strip()
        
        if not text:
            return jsonify({'error': 'Текст не может быть пустым'}), 400
        
        # Создаем аудио
        audio_buffer = tts_service.text_to_speech(text)
        
        # Возвращаем аудио файл
        return send_file(
            audio_buffer,
            mimetype='audio/mpeg',
            as_attachment=True,
            download_name='speech.mp3'
        )
        
    except ImportError:
        return jsonify({'error': 'Сервис TTS недоступен'}), 503
    except Exception as e:
        logger.error(f"TTS error: {e}")
        return jsonify({'error': 'Ошибка преобразования текста в речь'}), 500

@app.route('/api/speech_to_text', methods=['POST'])
def speech_to_text():
    """Преобразование речи в текст"""
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'Аудио файл не найден'}), 400
        
        audio_file = request.files['audio']
        if audio_file.filename == '':
            return jsonify({'error': 'Файл не выбран'}), 400
        
        # Проверяем формат файла
        if not audio_file.filename.lower().endswith(('.wav', '.mp3', '.ogg')):
            return jsonify({'error': 'Поддерживаются только WAV, MP3 и OGG файлы'}), 400
        
        # Читаем аудио данные
        audio_data = BytesIO()
        audio_file.save(audio_data)
        audio_data.seek(0)
        
        # Преобразуем речь в текст
        text = speech_service.speech_to_text(audio_data)
        
        return jsonify({
            'success': True,
            'text': text
        })
        
    except ImportError:
        return jsonify({'error': 'Сервис распознавания речи недоступен'}), 503
    except Exception as e:
        logger.error(f"Speech to text error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/user_info', methods=['GET'])
def get_user_info():
    """Получение информации о текущем пользователе"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'Требуется авторизация'}), 401
        
        user = db.get_user_by_phone(session['user_phone'])
        if not user:
            session.clear()
            return jsonify({'error': 'Пользователь не найден'}), 401
        
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'name': user['name'],
                'phone': user['phone'],
                'birth_date': user['birth_date']
            }
        })
        
    except Exception as e:
        logger.error(f"User info error: {e}")
        return jsonify({'success': False, 'error': 'Ошибка получения информации'}), 500

@app.route('/health')
def health():
    """Health check endpoint для Railway"""
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
