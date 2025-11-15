FROM node:18

# Install Python3 and pip
RUN apt-get update && apt-get install -y python3 python3-pip

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install

# Copy Python requirements and install
COPY requirements.txt .
RUN pip3 install -r requirements.txt

# Copy application files
COPY . .

EXPOSE 8080

CMD ["node", "api.js"]
