import sys
import json
import sqlite3
import requests
from datetime import datetime
import base64
from io import BytesIO
import logging
import hashlib
import urllib.parse
import urllib.request

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Конфигурация OpenRouter API
OPENROUTER_API_KEY = "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"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

class Database:
    def __init__(self, db_path="dream_interpreter.db"):
        self.db_path = db_path
        self.init_database()

    def init_database(self):
        """Инициализация базы данных"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    phone TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    birth_date TEXT NOT NULL,
                    password TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS chats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    chat_type TEXT NOT NULL,
                    telegram_chat_id TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    FOREIGN KEY (chat_id) REFERENCES chats (id)
                )
            ''')
            
            conn.commit()
            conn.close()
            logger.info("Database initialized successfully")
        except Exception as e:
            logger.error(f"Database initialization error: {e}")

    def create_user(self, phone, name, birth_date, password):
        """Создание нового пользователя"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO users (phone, name, birth_date, password, created_at)
                VALUES (?, ?, ?, ?, ?)
            ''', (phone, name, birth_date, password, datetime.now().isoformat()))
            
            user_id = cursor.lastrowid
            conn.commit()
            conn.close()
            return user_id
        except sqlite3.IntegrityError:
            raise ValueError("Пользователь с таким номером телефона уже существует")
        except Exception as e:
            logger.error(f"Create user error: {e}")
            raise

    def get_user_by_phone(self, phone):
        """Получение пользователя по номеру телефона"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT id, phone, name, birth_date, password, created_at 
                FROM users WHERE phone = ?
            ''', (phone,))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'id': row[0],
                    'phone': row[1],
                    'name': row[2],
                    'birth_date': row[3],
                    'password': row[4],
                    'created_at': row[5]
                }
            return None
        except Exception as e:
            logger.error(f"Get user error: {e}")
            return None

    def get_or_create_chat(self, user_id, chat_type='web', telegram_chat_id=None):
        """Получение или создание чата"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            if chat_type == 'telegram' and telegram_chat_id:
                cursor.execute('''
                    SELECT id FROM chats 
                    WHERE user_id = ? AND chat_type = ? AND telegram_chat_id = ?
                ''', (user_id, chat_type, telegram_chat_id))
            else:
                cursor.execute('''
                    SELECT id FROM chats 
                    WHERE user_id = ? AND chat_type = ?
                ''', (user_id, chat_type))
            
            row = cursor.fetchone()
            
            if row:
                chat_id = row[0]
            else:
                cursor.execute('''
                    INSERT INTO chats (user_id, chat_type, telegram_chat_id, created_at)
                    VALUES (?, ?, ?, ?)
                ''', (user_id, chat_type, telegram_chat_id, datetime.now().isoformat()))
                chat_id = cursor.lastrowid
                conn.commit()
            
            conn.close()
            return chat_id
        except Exception as e:
            logger.error(f"Get or create chat error: {e}")
            raise

    def save_message(self, chat_id, role, content):
        """Сохранение сообщения в базу данных"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO messages (chat_id, role, content, timestamp)
                VALUES (?, ?, ?, ?)
            ''', (chat_id, role, content, datetime.now().isoformat()))
            
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Save message error: {e}")
            raise

    def get_chat_history(self, chat_id, limit=10):
        """Получение истории чата"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT role, content, timestamp 
                FROM messages 
                WHERE chat_id = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            ''', (chat_id, limit))
            
            history = []
            for row in cursor.fetchall():
                history.append({
                    'role': row[0],
                    'content': row[1],
                    'timestamp': row[2]
                })
            
            conn.close()
            return list(reversed(history))
        except Exception as e:
            logger.error(f"Get chat history error: {e}")
            return []

class AIService:
    def __init__(self):
        self.api_key = OPENROUTER_API_KEY
        self.api_url = OPENROUTER_API_URL

    def get_ai_response(self, user_message, user_data, chat_history):
        """Получение ответа от AI"""
        try:
            system_prompt = self._create_system_prompt(user_data)
            
            messages = [{"role": "system", "content": system_prompt}]
            
            for msg in chat_history:
                messages.append({
                    "role": "user" if msg['role'] == 'user' else "assistant",
                    "content": msg['content']
                })
            
            messages.append({"role": "user", "content": user_message})
            
            response = requests.post(
                url=self.api_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://dream-interpreter.com",
                    "X-Title": "ИИ Сонник"
                },
                json={
                    "model": "deepseek/deepseek-chat-v3-0324",
                    "messages": messages,
                    "max_tokens": 1000
                },
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                return data['choices'][0]['message']['content']
            else:
                logger.error(f"OpenRouter API error: {response.status_code} - {response.text}")
                return "Извините, произошла ошибка при обработке вашего запроса."
                
        except Exception as e:
            logger.error(f"AI API error: {e}")
            return "Извините, сервис временно недоступен."

    def _create_system_prompt(self, user_data):
        """Создание системного промпта"""
        age = self._calculate_age(user_data.get('birth_date', ''))
        name = user_data.get('name', 'пользователь')
        
        return f"""Ты - опытный психолог-толкователь снов. Твоя задача - анализировать сны и давать психологическую интерпретацию.

Информация о пользователе:
- Имя: {name}
- Возраст: {age} лет

Твои особенности:
1. Давай развернутые, но понятные объяснения
2. Будь внимательным к деталям снов
3. Делай акцент на психологической интерпретации
4. Будь эмпатичным и поддерживающим
5. Учитывай контекст предыдущих бесед

Помни: сны - это способ подсознания общаться с нами. Твоя цель - помочь пользователю лучше понять себя."""

    def _calculate_age(self, birth_date_str):
        """Расчет возраста"""
        try:
            if not birth_date_str:
                return 0
            birth_date = datetime.strptime(birth_date_str, '%Y-%m-%d')
            today = datetime.now()
            age = today.year - birth_date.year
            
            if today.month < birth_date.month or (today.month == birth_date.month and today.day < birth_date.day):
                age -= 1
                
            return age
        except:
            return 0

class TTSService:
    @staticmethod
    def text_to_speech(text):
        """Преобразование текста в речь с использованием внешнего сервиса"""
        try:
            logger.info(f"TTS requested for text: {text[:100]}...")
            
            # Используем Yandex SpeechKit через публичный прокси
            # Кодируем текст для URL
            encoded_text = urllib.parse.quote(text)
            
            # URL для Yandex SpeechKit (бесплатный, без API ключа)
            url = f"https://tts.cyzon.us/tts?text={encoded_text}&lang=ru"
            
            # Скачиваем аудио
            response = urllib.request.urlopen(url)
            audio_data = response.read()
            
            # Конвертируем в base64
            audio_base64 = base64.b64encode(audio_data).decode('utf-8')
            
            logger.info("TTS successful")
            return audio_base64
            
        except Exception as e:
            logger.error(f"TTS error: {e}")
            # Fallback: возвращаем None, чтобы фронтенд использовал Web Speech API
            return None

class BackendAPI:
    def __init__(self):
        self.db = Database()
        self.ai_service = AIService()
        self.tts_service = TTSService()
    
    def register_user(self, phone, name, birth_date, password):
        """Регистрация нового пользователя"""
        try:
            user_id = self.db.create_user(phone, name, birth_date, password)
            return {
                'success': True,
                'message': 'Регистрация прошла успешно!',
                'user_id': user_id
            }
        except ValueError as e:
            return {
                'success': False,
                'message': str(e)
            }
        except Exception as e:
            logger.error(f"Register user error: {e}")
            return {
                'success': False,
                'message': 'Внутренняя ошибка сервера'
            }
    
    def login_user(self, phone, password):
        """Вход пользователя"""
        try:
            user = self.db.get_user_by_phone(phone)
            
            if user and user['password'] == password:
                return {
                    'success': True,
                    'message': 'Вход выполнен успешно!',
                    'user': {
                        'id': user['id'],
                        'name': user['name'],
                        'phone': user['phone'],
                        'birth_date': user['birth_date']
                    }
                }
            else:
                return {
                    'success': False,
                    'message': 'Неверный номер телефона или пароль'
                }
        except Exception as e:
            logger.error(f"Login user error: {e}")
            return {
                'success': False,
                'message': 'Внутренняя ошибка сервера'
            }
    
    def send_message(self, user_data, message):
        """Отправка сообщения и получение ответа от AI"""
        try:
            user = self.db.get_user_by_phone(user_data['phone'])
            if not user:
                return {'success': False, 'error': 'Пользователь не найден'}
            
            chat_id = self.db.get_or_create_chat(user['id'], 'web')
            self.db.save_message(chat_id, 'user', message)
            
            chat_history = self.db.get_chat_history(chat_id)
            ai_response = self.ai_service.get_ai_response(message, user, chat_history)
            
            self.db.save_message(chat_id, 'assistant', ai_response)
            
            return {
                'success': True,
                'response': ai_response
            }
        except Exception as e:
            logger.error(f"Send message error: {e}")
            return {
                'success': False,
                'message': 'Ошибка отправки сообщения'
            }
    
    def get_chat_history(self, user_data):
        """Получение истории чата"""
        try:
            user = self.db.get_user_by_phone(user_data['phone'])
            if not user:
                return {'success': False, 'error': 'Пользователь не найден'}
            
            chat_id = self.db.get_or_create_chat(user['id'], 'web')
            history = self.db.get_chat_history(chat_id)
            
            return {'success': True, 'history': history}
        except Exception as e:
            logger.error(f"Get chat history error: {e}")
            return {'success': False, 'history': []}
    
    def text_to_speech(self, text):
        """Преобразование текста в речь"""
        try:
            audio_base64 = self.tts_service.text_to_speech(text)
            
            if audio_base64:
                return {
                    'success': True,
                    'audio': audio_base64
                }
            else:
                return {
                    'success': False,
                    'message': 'Озвучка временно недоступна'
                }
        except Exception as e:
            logger.error(f"Text to speech error: {e}")
            return {
                'success': False,
                'message': 'Ошибка преобразования текста в речь'
            }
    
    def create_payment(self, plan='basic'):
        """Создание платежа"""
        try:
            plans = {
                'basic': {'price': '299', 'name': 'Базовый'},
                'premium': {'price': '799', 'name': 'Премиум'}
            }
            
            plan_data = plans.get(plan, plans['basic'])
            
            return {
                'success': True,
                'payment_url': '#',
                'payment_data': {
                    'plan': plan,
                    'price': plan_data['price'],
                    'name': plan_data['name']
                }
            }
        except Exception as e:
            logger.error(f"Create payment error: {e}")
            return {
                'success': False,
                'message': 'Ошибка создания платежа'
            }

# Глобальный экземпляр API
backend_api = BackendAPI()

# Функции для использования извне
def register_user(phone, name, birth_date, password):
    return backend_api.register_user(phone, name, birth_date, password)

def login_user(phone, password):
    return backend_api.login_user(phone, password)

def send_message(user_data, message):
    return backend_api.send_message(user_data, message)

def get_chat_history(user_data):
    return backend_api.get_chat_history(user_data)

def text_to_speech(text):
    return backend_api.text_to_speech(text)

def create_payment(plan='basic'):
    return backend_api.create_payment(plan)

# Основная функция для обработки команд
def main():
    if len(sys.argv) > 1:
        try:
            args = json.loads(sys.argv[1])
            action = args.get('action')
            logger.info(f"Processing action: {action}")
            
            if action == 'register':
                result = register_user(
                    args.get('phone', ''), 
                    args.get('name', ''), 
                    args.get('birth_date', ''), 
                    args.get('password', '')
                )
            elif action == 'login':
                result = login_user(
                    args.get('phone', ''), 
                    args.get('password', '')
                )
            elif action == 'send_message':
                result = send_message(
                    args.get('user_data', {}), 
                    args.get('message', '')
                )
            elif action == 'get_chat_history':
                result = get_chat_history(args.get('user_data', {}))
            elif action == 'text_to_speech':
                result = text_to_speech(args.get('text', ''))
            elif action == 'create_payment':
                result = create_payment(args.get('plan', 'basic'))
            else:
                result = {'success': False, 'error': 'Unknown action'}
            
            print(json.dumps(result))
            
        except Exception as e:
            logger.error(f"Main execution error: {e}")
            print(json.dumps({
                'success': False,
                'message': f'Error: {str(e)}'
            }))
    else:
        # Инициализация базы данных
        logger.info("Initializing database...")
        db = Database()
        logger.info("Database ready!")

if __name__ == '__main__':
    main()
