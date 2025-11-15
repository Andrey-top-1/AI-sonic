FROM node:18-bullseye

# Устанавливаем Python3 и pip в Debian-based образе
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Устанавливаем зависимости Python
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Устанавливаем зависимости Node.js
COPY package*.json .
RUN npm install

# Копируем исходный код
COPY . .

EXPOSE 8080

CMD ["node", "api.js"]
