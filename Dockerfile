# Stage 1: Build frontend (static files)
FROM node:18-alpine AS builder
WORKDIR /app
COPY web/public ./public

# Stage 2: Run API + serve static
FROM node:18-alpine
WORKDIR /app

# ติดตั้ง dependencies
COPY package*.json ./
RUN npm install

# คัดลอกโค้ด API
COPY api ./api

# คัดลอก frontend (จาก stage builder)
COPY --from=builder /app/public ./public

# เปิด port
EXPOSE 4000

# Start server (แก้เป็นไฟล์เริ่มต้นของ API)
CMD ["node", "api/current.js"]
