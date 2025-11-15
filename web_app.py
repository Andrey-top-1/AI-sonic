import sqlite3
import requests
import json
import sys
import logging
from datetime import datetime
import hashlib

# Настройка логирования
logging.basicConfig(level=logging.INFO)
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
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Таблица пользователей
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
        
        # Таблица чатов
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                chat_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        
        # Таблица сообщений
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

    def create_user(self, phone, name, birth_date, password):
        """Создание нового пользователя"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO users (phone, name, birth_date, password, created_at)
                VALUES (?, ?, ?, ?, ?)
            ''', (phone, name, birth_date, password, datetime.now().isoformat()))
            
            user_id = cursor.lastrowid
            conn.commit()
            return user_id
        except sqlite3.IntegrityError:
            raise ValueError("Пользователь с таким номером телефона уже существует")
        finally:
            conn.close()

    def get_user_by_phone(self, phone):
        """Получение пользователя по номеру телефона"""
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

    def get_or_create_chat(self, user_id, chat_type='web'):
        """Получение или создание чата"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id FROM chats 
            WHERE user_id = ? AND chat_type = ?
        ''', (user_id, chat_type))
        
        row = cursor.fetchone()
        
        if row:
            chat_id = row[0]
        else:
            cursor.execute('''
                INSERT INTO chats (user_id, chat_type, created_at)
                VALUES (?, ?, ?)
            ''', (user_id, chat_type, datetime.now().isoformat()))
            chat_id = cursor.lastrowid
            conn.commit()
        
        conn.close()
        return chat_id

    def save_message(self, chat_id, role, content):
        """Сохранение сообщения в базу данных"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO messages (chat_id, role, content, timestamp)
            VALUES (?, ?, ?, ?)
        ''', (chat_id, role, content, datetime.now().isoformat()))
        
        conn.commit()
        conn.close()

    def get_chat_history(self, chat_id, limit=10):
        """Получение истории чата"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT role, content, timestamp 
            FROM messages 
            WHERE chat_id = ? 
            ORDER BY timestamp ASC
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
        return history

class AIService:
    def __init__(self):
        self.api_key = OPENROUTER_API_KEY
        self.api_url = OPENROUTER_API_URL

    def get_ai_response(self, user_message, user_data, chat_history):
        """Получение ответа от AI с учетом истории и данных пользователя"""
        try:
            # Создаем системный промт с данными пользователя
            system_prompt = self._create_system_prompt(user_data)
            
            # Формируем сообщения для AI
            messages = [{"role": "system", "content": system_prompt}]
            
            # Добавляем историю сообщений
            for msg in chat_history:
                messages.append({
                    "role": "user" if msg['role'] == 'user' else "assistant",
                    "content": msg['content']
                })
            
            # Добавляем текущее сообщение пользователя
            messages.append({"role": "user", "content": user_message})
            
            logger.info(f"Sending request to AI with {len(messages)} messages")
            
            # Отправляем запрос к OpenRouter API
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
                    "max_tokens": 1000,
                    "temperature": 0.7
                },
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                ai_response = data['choices'][0]['message']['content']
                logger.info("AI response received successfully")
                return ai_response
            else:
                logger.error(f"OpenRouter API error: {response.status_code} - {response.text}")
                return "Извините, произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте еще раз."
                
        except Exception as e:
            logger.error(f"AI API error: {e}")
            return "Извините, сервис временно недоступен. Пожалуйста, попробуйте позже."

    def _create_system_prompt(self, user_data):
        """Создание системного промпта с данными пользователя"""
        age = self._calculate_age(user_data['birth_date'])
        name = user_data['name']
        
        return f"""Ты - опытный психолог-толкователь снов с 20-летним стажем. Твоя задача - анализировать сны и давать глубокую психологическую интерпретацию.

ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:
- Имя: {name}
- Возраст: {age} лет

ТВОИ ОСОБЕННОСТИ:
1. Анализируй сны с точки зрения психологии (Фрейд, Юнг, современные подходы)
2. Учитывай контекст предыдущих бесед и снов пользователя
3. Давай развернутые, но понятные объяснения
4. Будь эмпатичным и поддерживающим
5. Предлагай практические рекомендации
6. Связывай символы сна с реальной жизнью пользователя
7. Учитывай возрастные особенности

ВАЖНЫЕ ПРИНЦИПЫ:
- Сны - это способ подсознания общаться с сознанием
- Каждый символ имеет значение
- Контекст предыдущих снов важен для точной интерпретации
- Давай не только анализ, но и рекомендации

ФОРМАТ ОТВЕТА:
1. Анализ основных символов
2. Психологическая интерпретация
3. Связь с реальной жизнью
4. Практические рекомендации

Помни: ты помогаешь {name} лучше понять себя через анализ снов."""

    def _calculate_age(self, birth_date_str):
        """Расчет возраста"""
        try:
            birth_date = datetime.strptime(birth_date_str, '%Y-%m-%d')
            today = datetime.now()
            age = today.year - birth_date.year
            
            if today.month < birth_date.month or (today.month == birth_date.month and today.day < birth_date.day):
                age -= 1
                
            return age
        except:
            return "неизвестно"

class BackendAPI:
    def __init__(self):
        self.db = Database()
        self.ai_service = AIService()
    
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
            
            # Получаем или создаем чат
            chat_id = self.db.get_or_create_chat(user['id'], 'web')
            
            # Сохраняем сообщение пользователя
            self.db.save_message(chat_id, 'user', message)
            
            # Получаем историю чата (последние 6 сообщений для контекста)
            chat_history = self.db.get_chat_history(chat_id, limit=6)
            
            logger.info(f"Chat history for user {user['name']}: {len(chat_history)} messages")
            
            # Получаем ответ от AI
            ai_response = self.ai_service.get_ai_response(message, user, chat_history)
            
            # Сохраняем ответ AI
            self.db.save_message(chat_id, 'assistant', ai_response)
            
            return {
                'success': True,
                'response': ai_response
            }
        except Exception as e:
            logger.error(f"Send message error: {e}")
            return {
                'success': False,
                'message': 'Извините, произошла ошибка. Пожалуйста, попробуйте еще раз.'
            }
    
    def get_chat_history(self, user_data):
        """Получение истории чата"""
        try:
            user = self.db.get_user_by_phone(user_data['phone'])
            if not user:
                return {'success': False, 'error': 'Пользователь не найден'}
            
            chat_id = self.db.get_or_create_chat(user['id'], 'web')
            history = self.db.get_chat_history(chat_id, limit=20)
            
            return {'success': True, 'history': history}
        except Exception as e:
            logger.error(f"Get chat history error: {e}")
            return {'success': False, 'history': []}

# Глобальный экземпляр API
backend_api = BackendAPI()

# Основная функция для обработки команд
def main():
    if len(sys.argv) > 1:
        try:
            args = json.loads(sys.argv[1])
            action = args.get('action')
            
            if action == 'register':
                result = backend_api.register_user(
                    args['phone'], 
                    args['name'], 
                    args['birth_date'], 
                    args['password']
                )
            elif action == 'login':
                result = backend_api.login_user(args['phone'], args['password'])
            elif action == 'send_message':
                result = backend_api.send_message(args['user_data'], args['message'])
            elif action == 'get_chat_history':
                result = backend_api.get_chat_history(args['user_data'])
            else:
                result = {'success': False, 'error': 'Unknown action'}
            
            print(json.dumps(result, ensure_ascii=False))
            
        except Exception as e:
            logger.error(f"Main execution error: {e}")
            print(json.dumps({
                'success': False,
                'message': f'Error: {str(e)}'
            }, ensure_ascii=False))
    else:
        # Инициализация базы данных
        print("Initializing database...")
        db = Database()
        print("Database ready!")

if __name__ == '__main__':
    main()
