# tts_service.py
import pyttsx3
import os
import tempfile
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

# Инициализация движка TTS
engine = pyttsx3.init()

# Настройки голоса
def setup_voice():
    voices = engine.getProperty('voices')
    # Пытаемся найти русский голос
    for voice in voices:
        if 'russian' in voice.name.lower() or 'russian' in voice.id.lower():
            engine.setProperty('voice', voice.id)
            break
    
    # Настройка скорости и громкости
    engine.setProperty('rate', 150)  # Скорость речи
    engine.setProperty('volume', 0.8)  # Громкость (0.0 до 1.0)

setup_voice()

@app.route('/tts', methods=['POST'])
def text_to_speech():
    try:
        data = request.get_json()
        text = data.get('text', '')
        
        if not text:
            return jsonify({'success': False, 'error': 'No text provided'}), 400
        
        # Создаем временный файл для аудио
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
            temp_filename = temp_file.name
        
        # Сохраняем речь в файл
        engine.save_to_file(text, temp_filename)
        engine.runAndWait()
        
        # Отправляем файл обратно
        return send_file(
            temp_filename,
            as_attachment=True,
            download_name='speech.mp3',
            mimetype='audio/mpeg'
        )
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        # Удаляем временный файл после отправки
        try:
            os.unlink(temp_filename)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
