import sqlite3
import requests
import json
import logging
import os
from datetime import datetime
import telebot

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Конфигурация Telegram бота
TELEGRAM_BOT_TOKEN = "8328551756:AAEWPTFIWrREap94-pL86p6-nWM_3UJcB2g"
OPENROUTER_API_KEY = "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"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Инициализация бота
bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

class Database:
    def __init__(self, db_path="dream_interpreter.db"):
        self.db_path = db_path
        self.init_database()

    def init_database(self):
        """Инициализация таблиц если их нет"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Добавляем telegram_id в таблицу users если его нет
        cursor.execute("PRAGMA table_info(users)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'telegram_id' not in columns:
            cursor.execute('ALTER TABLE users ADD COLUMN telegram_id TEXT UNIQUE')
            logger.info("Added telegram_id column to users table")
        
        conn.commit()
        conn.close()

    def get_user_by_telegram_id(self, telegram_id):
        """Получение пользователя по Telegram ID"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, phone, name, birth_date, created_at 
            FROM users WHERE telegram_id = ?
        ''', (str(telegram_id),))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {
                'id': row[0],
                'phone': row[1],
                'name': row[2],
                'birth_date': row[3],
                'created_at': row[4]
            }
        return None

    def create_telegram_user(self, telegram_id, name, phone=None):
        """Создание пользователя Telegram"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO users (telegram_id, name, phone, birth_date, password, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (str(telegram_id), name, phone, '2000-01-01', 'telegram', datetime.now().isoformat()))
            
            user_id = cursor.lastrowid
            conn.commit()
            return user_id
        except sqlite3.IntegrityError:
            # Если пользователь уже существует, просто возвращаем его ID
            user = self.get_user_by_telegram_id(telegram_id)
            return user['id'] if user else None
        except Exception as e:
            logger.error(f"Error creating telegram user: {e}")
            return None
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
            ''', (user_id, chat_type, str(telegram_chat_id), datetime.now().isoformat()))
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

    def get_chat_history(self, chat_id, limit=6):
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
            logger.error(f"AI API error: {str(e)}")
            return "Извините, сервис временно недоступен. Пожалуйста, попробуйте позже."

    def _create_system_prompt(self, user_data):
        """Создание системного промпта с данными пользователя"""
        name = user_data.get('name', 'Пользователь')
        
        return f"""Ты - опытный психолог-толкователь снов с 20-летним стажем. Твоя задача - анализировать сны и давать глубокую психологическую интерпретацию.

ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:
- Имя: {name}

ТВОИ ОСОБЕННОСТИ:
1. Анализируй сны с точки зрения психологии (Фрейд, Юнг, современные подходы)
2. Учитывай контекст предыдущих бесед и снов пользователя
3. Давай развернутые, но понятные объяснения
4. Будь эмпатичным и поддерживающим
5. Предлагай практические рекомендации
6. Связывай символы сна с реальной жизнью пользователя

ФОРМАТ ОТВЕТА:
1. Анализ основных символов
2. Психологическая интерпретация
3. Связь с реальной жизнью
4. Практические рекомендации

Помни: ты помогаешь {name} лучше понять себя через анализ снов."""

class TelegramBotHandler:
    def __init__(self):
        self.db = Database()
        self.ai_service = AIService()

    def handle_message(self, message):
        """Обработка сообщения от пользователя"""
        try:
            telegram_id = message.from_user.id
            user_message = message.text
            
            # Получаем или создаем пользователя
            user = self.db.get_user_by_telegram_id(telegram_id)
            if not user:
                user_name = f"{message.from_user.first_name} {message.from_user.last_name or ''}".strip()
                if not user_name.strip():
                    user_name = "Пользователь"
                    
                user_id = self.db.create_telegram_user(telegram_id, user_name)
                if user_id:
                    user = self.db.get_user_by_telegram_id(telegram_id)
                else:
                    user = {'id': telegram_id, 'name': user_name}
            
            # Получаем или создаем чат
            chat_id = self.db.get_or_create_chat(user['id'], 'telegram', message.chat.id)
            
            # Сохраняем сообщение пользователя
            self.db.save_message(chat_id, 'user', user_message)
            
            # Получаем историю чата
            chat_history = self.db.get_chat_history(chat_id, limit=6)
            
            # Получаем ответ от AI
            ai_response = self.ai_service.get_ai_response(user_message, user, chat_history)
            
            # Сохраняем ответ AI
            self.db.save_message(chat_id, 'assistant', ai_response)
            
            return ai_response
            
        except Exception as e:
            logger.error(f"Telegram bot error: {str(e)}")
            return "Извините, произошла ошибка. Пожалуйста, попробуйте еще раз."

# Создаем обработчик
bot_handler = TelegramBotHandler()

# Обработчики команд бота
@bot.message_handler(commands=['start'])
def send_welcome(message):
    welcome_text = """
👋 Привет! Я ИИ-сонник @sonnik_osoznannosti_bot 

Я помогу вам понять значение ваших снов через психологический анализ. 

Просто опишите свой сон, и я дам вам:
• Анализ основных символов
• Психологическую интерпретацию  
• Связь с реальной жизнью
• Практические рекомендации

📝 Пример: "Мне приснилось, что я лечу над городом и вижу все сверху"

Расскажите, что вам приснилось? 💭
    """
    bot.reply_to(message, welcome_text.strip())

@bot.message_handler(commands=['help'])
def send_help(message):
    help_text = """
🤖 Как пользоваться ботом:

1. Просто напишите описание своего сна
2. Я проанализирую его с точки зрения психологии
3. Дам развернутую интерпретацию и рекомендации

📚 Примеры снов для анализа:
• "Приснилось, что я опаздываю на важную встречу"
• "Видел во сне воду, океан или реку"
• "Снились животные, птицы или насекомые"
• "Приснились знакомые люди или родственники"

💡 Чем подробнее вы опишете сон, тем точнее будет анализ!

Расскажите свой сон... ✨
    """
    bot.reply_to(message, help_text.strip())

@bot.message_handler(commands=['about'])
def send_about(message):
    about_text = """
ℹ️ О боте:

Я - ИИ-помощник для толкования снов, основанный на современных психологических подходах (Фрейд, Юнг, современная психология).

🔮 Что я умею:
• Анализировать символы и образы из снов
• Давать психологическую интерпретацию
• Связывать сны с вашей реальной жизнью
• Предлагать практические рекомендации

📊 Использую модель DeepSeek для максимально точных и полезных ответов.

Напишите свой сон для анализа! 🌙
    """
    bot.reply_to(message, about_text.strip())

@bot.message_handler(func=lambda message: True)
def handle_all_messages(message):
    try:
        # Показываем typing индикатор
        bot.send_chat_action(message.chat.id, 'typing')
        
        # Обрабатываем сообщение
        response = bot_handler.handle_message(message)
        
        # Отправляем ответ
        bot.reply_to(message, response)
        
    except Exception as e:
        logger.error(f"Error handling message: {str(e)}")
        bot.reply_to(message, "⚠️ Произошла ошибка при обработке вашего сообщения. Пожалуйста, попробуйте еще раз.")

if __name__ == '__main__':
    logger.info("🤖 Telegram bot @sonnik_osoznannosti_bot started...")
    logger.info(f"🔗 Token: {TELEGRAM_BOT_TOKEN[:10]}...")
    
    try:
        bot.infinity_polling(timeout=60, long_polling_timeout=60)
    except Exception as e:
        logger.error(f"Bot polling error: {str(e)}")
