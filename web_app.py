import sqlite3
import requests
import json
import logging
import os
from datetime import datetime
import telebot

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Конфигурация Telegram бота
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8328551756:AAEWPTFIWrREap94-pL86p6-nWM_3UJcB2g')
OPENROUTER_API_KEY = "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"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

if not TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN == 'YOUR_TELEGRAM_BOT_TOKEN':
    logger.error("Please set TELEGRAM_BOT_TOKEN environment variable")
    exit(1)

# Инициализация бота
bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

class Database:
    def __init__(self, db_path="dream_interpreter.db"):
        self.db_path = db_path

    def get_user_by_telegram_id(self, telegram_id):
        """Получение пользователя по Telegram ID"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, phone, name, birth_date, telegram_id, created_at 
            FROM users WHERE telegram_id = ?
        ''', (telegram_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {
                'id': row[0],
                'phone': row[1],
                'name': row[2],
                'birth_date': row[3],
                'telegram_id': row[4],
                'created_at': row[5]
            }
        return None

    def create_telegram_user(self, telegram_id, name):
        """Создание пользователя Telegram"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO users (telegram_id, name, birth_date, password, created_at)
                VALUES (?, ?, ?, ?, ?)
            ''', (telegram_id, name, '2000-01-01', 'telegram', datetime.now().isoformat()))
            
            user_id = cursor.lastrowid
            conn.commit()
            return user_id
        except sqlite3.IntegrityError:
            # Если пользователь уже существует, просто возвращаем его ID
            user = self.get_user_by_telegram_id(telegram_id)
            return user['id'] if user else None
        finally:
            conn.close()

    def get_or_create_chat(self, user_id, telegram_chat_id):
        """Получение или создание чата"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id FROM chats 
            WHERE user_id = ? AND chat_type = 'telegram'
        ''', (user_id,))
        
        row = cursor.fetchone()
        
        if row:
            chat_id = row[0]
        else:
            cursor.execute('''
                INSERT INTO chats (user_id, chat_type, telegram_chat_id, created_at)
                VALUES (?, 'telegram', ?, ?)
            ''', (user_id, telegram_chat_id, datetime.now().isoformat()))
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
        """Получение ответа от AI"""
        try:
            # Создаем системный промт
            system_prompt = f"""Ты - опытный психолог-толкователь снов. Анализируй сны и давай глубокую психологическую интерпретацию.

Пользователь: {user_data.get('name', 'пользователь')}

Твои особенности:
1. Анализируй сны с точки зрения психологии
2. Будь эмпатичным и поддерживающим
3. Давай развернутые, но понятные объяснения
4. Предлагай практические рекомендации

Формат ответа:
- Анализ символов
- Психологическая интерпретация  
- Практические рекомендации"""

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
            
            # Отправляем запрос к OpenRouter API
            response = requests.post(
                url=self.api_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json; charset=utf-8"
                },
                json={
                    "model": "deepseek/deepseek-chat-v3-0324",
                    "messages": messages,
                    "max_tokens": 800,
                    "temperature": 0.7
                },
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                return data['choices'][0]['message']['content']
            else:
                logger.error(f"OpenRouter API error: {response.status_code}")
                return "Извините, произошла ошибка. Пожалуйста, попробуйте еще раз."
                
        except Exception as e:
            logger.error(f"AI API error: {str(e)}")
            return "Извините, сервис временно недоступен."

class TelegramBotHandler:
    def __init__(self):
        self.db = Database()
        self.ai_service = AIService()

    def handle_message(self, message):
        """Обработка сообщения от пользователя"""
        try:
            telegram_id = str(message.from_user.id)
            user_message = message.text
            
            if not user_message or user_message.strip() == '':
                return "Пожалуйста, опишите свой сон."
            
            # Получаем или создаем пользователя
            user = self.db.get_user_by_telegram_id(telegram_id)
            if not user:
                user_name = f"{message.from_user.first_name or ''} {message.from_user.last_name or ''}".strip()
                if not user_name:
                    user_name = "Пользователь"
                user_id = self.db.create_telegram_user(telegram_id, user_name)
                user = self.db.get_user_by_telegram_id(telegram_id)
            
            if not user:
                return "Ошибка создания пользователя."
            
            # Получаем или создаем чат
            chat_id = self.db.get_or_create_chat(user['id'], message.chat.id)
            
            # Сохраняем сообщение пользователя
            self.db.save_message(chat_id, 'user', user_message)
            
            # Получаем историю чата
            chat_history = self.db.get_chat_history(chat_id, limit=4)
            
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

@bot.message_handler(commands=['start', 'help'])
def send_welcome(message):
    welcome_text = """👋 Привет! Я ИИ-сонник. 

Просто опишите свой сон, и я помогу вам понять его значение с психологической точки зрения.

Пример: "Мне приснилось, что я летаю над городом..." """
    
    bot.reply_to(message, welcome_text)

@bot.message_handler(func=lambda message: True)
def handle_message(message):
    response = bot_handler.handle_message(message)
    bot.reply_to(message, response)

if __name__ == '__main__':
    logger.info("Telegram bot started...")
    bot.polling(none_stop=True)
