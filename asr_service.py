# asr_service.py
import speech_recognition as sr
import tempfile
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
recognizer = sr.Recognizer()

@app.route('/asr', methods=['POST'])
def speech_to_text():
    try:
        # Проверяем, есть ли аудиофайл в запросе
        if 'audio' not in request.files:
            return jsonify({'success': False, 'error': 'No audio file provided'}), 400
        
        audio_file = request.files['audio']
        
        # Сохраняем временно файл
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            audio_file.save(temp_file.name)
            temp_filename = temp_file.name
        
        # Распознаем речь
        with sr.AudioFile(temp_filename) as source:
            # Подстраиваемся под окружающий шум
            recognizer.adjust_for_ambient_noise(source)
            audio = recognizer.record(source)
            
            # Пытаемся распознать с помощью Google
            try:
                text = recognizer.recognize_google(audio, language='ru-RU')
                return jsonify({'success': True, 'text': text})
            
            except sr.UnknownValueError:
                return jsonify({'success': False, 'error': 'Не удалось распознать речь'})
            
            except sr.RequestError as e:
                return jsonify({'success': False, 'error': f'Ошибка сервиса распознавания: {e}'})
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    
    finally:
        # Удаляем временный файл
        try:
            os.unlink(temp_filename)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
