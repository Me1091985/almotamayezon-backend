FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production || npm install --production

# Copy source files
COPY . .

EXPOSE 5005

CMD ["node", "server.js"]
