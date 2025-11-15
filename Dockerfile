FROM node:18-alpine

# Устанавливаем Python3 и необходимые зависимости
RUN apk add --no-cache \
    python3 \
    py3-pip \
    build-base \
    python3-dev

# Создаем виртуальное окружение Python
RUN python3 -m venv /opt/venv

# Активируем виртуальное окружение и устанавливаем зависимости
ENV PATH="/opt/venv/bin:$PATH"
RUN pip3 install --no-cache-dir -r requirements.txt

# Устанавливаем зависимости Node.js
COPY package*.json .
RUN npm install

# Копируем исходный код
COPY . .

EXPOSE 8080

CMD ["node", "api.js"]
