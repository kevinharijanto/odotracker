FROM node:20-slim

# Install dependencies for better-sqlite3 and Tesseract
# We use Debian instead of Alpine to avoid musl libc issues (fcntl64)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

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
