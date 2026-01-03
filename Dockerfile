# Use Node.js 20 Alpine
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production
RUN npm install typescript ts-node-dev --save-dev

# Copy rest of the files
COPY . .

# Expose port
EXPOSE 8000

# Command to run server.ts with ts-node
CMD ["npx", "ts-node", "server.ts"]
