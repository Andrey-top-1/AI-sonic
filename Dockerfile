FROM node:18-alpine

# Install Python and required dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    build-base \
    python3-dev \
    && ln -sf python3 /usr/bin/python

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install

# Copy Python requirements and install
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8080

# Start application
CMD ["node", "api.js"]
