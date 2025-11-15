import sqlite3
import requests
import json
import logging
import os
import sys
from datetime import datetime

# Проверяем наличие telebot
try:
    import telebot
    from telebot import types
    TELEBOT_AVAILABLE = True
except ImportError as e:
    print(f"Telegram bot dependencies not available: {e}")
    print("Telegram bot will not start")
    TELEBOT_AVAILABLE = False
    sys.exit(0)  # Выходим без ошибки

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Конфигурация
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8328551756:AAEWPTFIWrREap94-pL86p6-nWM_3UJcB2g')
OPENROUTER_API_KEY = "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"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

if not TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN == 'YOUR_TELEGRAM_BOT_TOKEN':
    logger.error("TELEGRAM_BOT_TOKEN not set!")
    sys.exit(0)

bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

# Хранилище состояний пользователей
user_states = {}
user_data = {}

class Database:
    def __init__(self, db_path="dream_interpreter.db"):
        self.db_path = db_path

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

    def link_telegram_user(self, user_id, telegram_id, telegram_username):
        """Привязка Telegram аккаунта к существующему пользователю"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                UPDATE users 
                SET telegram_id = ?, telegram_username = ?
                WHERE id = ?
            ''', (telegram_id, telegram_username, user_id))
            
            conn.commit()
            return True
        except Exception as e:
            logger.error(f"Error linking telegram user: {e}")
            return False
        finally:
            conn.close()

    def get_or_create_chat(self, user_id, chat_type='telegram', telegram_chat_id=None):
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
                INSERT INTO chats (user_id, chat_type, telegram_chat_id, created_at)
                VALUES (?, ?, ?, ?)
            ''', (user_id, chat_type, telegram_chat_id, datetime.now().isoformat()))
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
            
            logger.info(f"Sending AI request with {len(messages)} messages")
            
            # Отправляем запрос к OpenRouter API
            response = requests.post(
                url=self.api_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json; charset=utf-8",
                    "HTTP-Referer": "https://dream-interpreter.com",
                    "X-Title": "Dream Interpreter"
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
                logger.error(f"OpenRouter API error: {response.status_code}")
                return "Извините, произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте еще раз."
                
        except Exception as e:
            logger.error(f"AI API error: {str(e)}")
            return "Извините, сервис временно недоступен. Пожалуйста, попробуйте позже."

    def _create_system_prompt(self, user_data):
        """Создание системного промпта с данными пользователя"""
        age = self._calculate_age(user_data.get('birth_date', '2000-01-01'))
        name = user_data.get('name', 'пользователь')
        
        return f"""Ты - опытный психолог-толкователь снов с 20-летним стажем. Твоя задача - анализировать сны и давать глубокую психологическую интерпретацию.

ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:
- Имя: {name}
- Возраст: {age} лет

ТВОИ ОСОБЕННОСТИ:
1. Анализируй сны с точки зрения психологии
2. Учитывай контекст предыдущих бесед
3. Давай развернутые, но понятные объяснения
4. Будь эмпатичным и поддерживающим
5. Предлагай практические рекомендации

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

# Инициализация сервисов
db = Database()
ai_service = AIService()

@bot.message_handler(commands=['start'])
def start_handler(message):
    """Обработчик команды /start"""
    user_id = message.from_user.id
    
    # Сбрасываем состояние пользователя
    user_states[user_id] = 'waiting_phone'
    user_data[user_id] = {}
    
    bot.send_message(
        message.chat.id,
        "👋 Добро пожаловать в ИИ-сонник!\n\n"
        "Для начала работы необходимо авторизоваться.\n"
        "📱 *Введите ваш номер телефона:*\n"
        "(в формате +7XXXXXXXXXX или 8XXXXXXXXXX)",
        parse_mode='Markdown'
    )

@bot.message_handler(func=lambda message: user_states.get(message.from_user.id) == 'waiting_phone')
def phone_handler(message):
    """Обработчик ввода номера телефона"""
    user_id = message.from_user.id
    phone = message.text.strip()
    
    # Простая валидация номера телефона
    if not (phone.startswith('+7') or phone.startswith('8') or phone.startswith('7')):
        bot.send_message(
            message.chat.id,
            "❌ Неверный формат номера. Пожалуйста, введите номер в формате:\n"
            "+7XXXXXXXXXX или 8XXXXXXXXXX"
        )
        return
    
    # Нормализуем номер телефона
    if phone.startswith('8'):
        phone = '+7' + phone[1:]
    elif phone.startswith('7') and not phone.startswith('+7'):
        phone = '+' + phone
    
    # Проверяем существование пользователя
    user = db.get_user_by_phone(phone)
    if not user:
        bot.send_message(
            message.chat.id,
            "❌ Пользователь с таким номером телефона не найден.\n"
            "Пожалуйста, зарегистрируйтесь через веб-версию или проверьте номер."
        )
        user_states[user_id] = 'waiting_phone'
        return
    
    # Сохраняем данные пользователя
    user_data[user_id]['phone'] = phone
    user_data[user_id]['user_info'] = user
    
    # Переходим к запросу пароля
    user_states[user_id] = 'waiting_password'
    
    bot.send_message(
        message.chat.id,
        "🔐 *Введите ваш пароль:*",
        parse_mode='Markdown'
    )

@bot.message_handler(func=lambda message: user_states.get(message.from_user.id) == 'waiting_password')
def password_handler(message):
    """Обработчик ввода пароля"""
    user_id = message.from_user.id
    password = message.text.strip()
    
    user_info = user_data[user_id]['user_info']
    
    # Проверяем пароль
    if user_info['password'] != password:
        bot.send_message(
            message.chat.id,
            "❌ Неверный пароль. Пожалуйста, попробуйте еще раз:"
        )
        return
    
    # Привязываем Telegram аккаунт
    telegram_username = message.from_user.username
    db.link_telegram_user(user_info['id'], str(user_id), telegram_username)
    
    # Авторизация успешна
    user_states[user_id] = 'authorized'
    
    # Загружаем историю чатов
    chat_id = db.get_or_create_chat(user_info['id'], 'telegram', message.chat.id)
    history = db.get_chat_history(chat_id, limit=10)
    
    # Отправляем приветственное сообщение
    welcome_text = (
        f"✅ *Авторизация успешна!*\n\n"
        f"Привет, {user_info['name']}! 👋\n"
        f"Теперь вы можете описывать свои сны, и я помогу их растолковать.\n\n"
        f"*Пример:* \"Мне приснилось, что я летаю над городом...\"\n\n"
    )
    
    if history:
        welcome_text += f"📚 Загружено {len(history)} предыдущих сообщений из истории."
    
    bot.send_message(message.chat.id, welcome_text, parse_mode='Markdown')

@bot.message_handler(func=lambda message: user_states.get(message.from_user.id) == 'authorized')
def message_handler(message):
    """Обработчик сообщений после авторизации"""
    user_id = message.from_user.id
    
    if not message.text or message.text.strip() == '':
        bot.send_message(message.chat.id, "Пожалуйста, опишите ваш сон.")
        return
    
    user_info = user_data[user_id]['user_info']
    user_message = message.text.strip()
    
    # Показываем индикатор набора
    bot.send_chat_action(message.chat.id, 'typing')
    
    try:
        # Получаем или создаем чат
        chat_id = db.get_or_create_chat(user_info['id'], 'telegram', message.chat.id)
        
        # Сохраняем сообщение пользователя
        db.save_message(chat_id, 'user', user_message)
        
        # Получаем историю чата
        chat_history = db.get_chat_history(chat_id, limit=6)
        
        # Получаем ответ от AI
        ai_response = ai_service.get_ai_response(user_message, user_info, chat_history)
        
        # Сохраняем ответ AI
        db.save_message(chat_id, 'assistant', ai_response)
        
        # Отправляем ответ пользователю
        bot.send_message(message.chat.id, ai_response)
        
    except Exception as e:
        logger.error(f"Error processing message: {e}")
        bot.send_message(
            message.chat.id,
            "❌ Произошла ошибка при обработке вашего сообщения. Пожалуйста, попробуйте еще раз."
        )

@bot.message_handler(func=lambda message: True)
def default_handler(message):
    """Обработчик сообщений по умолчанию"""
    user_id = message.from_user.id
    
    if user_id not in user_states:
        bot.send_message(
            message.chat.id,
            "Для начала работы отправьте команду /start"
        )
    else:
        bot.send_message(
            message.chat.id,
            "Пожалуйста, завершите процесс авторизации или отправьте команду /start для начала."
        )

if __name__ == '__main__':
    if TELEBOT_AVAILABLE:
        logger.info("Telegram bot started with phone authorization...")
        try:
            bot.polling(none_stop=True, interval=0)
        except Exception as e:
            logger.error(f"Bot polling error: {e}")
    else:
        logger.info("Telegram bot dependencies not available - skipping")
