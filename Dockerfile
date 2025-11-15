FROM node:18-alpine

# Устанавливаем Python3 и необходимые зависимости
RUN apk add --no-cache \
    python3 \
    py3-pip \
    build-base \
    python3-dev

# Устанавливаем зависимости Python
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Устанавливаем зависимости Node.js
COPY package*.json .
RUN npm install

# Копируем исходный код
COPY . .

# Создаем симлинк python3 -> python если нужно
RUN ln -sf python3 /usr/bin/python || true

EXPOSE 8080

CMD ["node", "api.js"]
