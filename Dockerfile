FROM node:20-alpine

# Install dependencies for better-sqlite3 and Tesseract
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    tesseract-ocr \
    tesseract-ocr-data-eng

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create data directory
RUN mkdir -p /app/data/photos

# Set environment variables
ENV NODE_ENV=production

# Run the bot
CMD ["node", "src/index.js"]
