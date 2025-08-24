# Stage 1: Build frontend (static files)
FROM node:18-alpine AS builder
WORKDIR /app
COPY web/public ./public

# ไม่มี build step (เพราะคุณเขียน HTML/CSS/JS ธรรมดา)
# แค่ copy ไฟล์ static มาไว้

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

# คัดลอกไฟล์อื่นที่จำเป็น
COPY vercel.json ./
COPY .env ./

# เปิด port
EXPOSE 4000

# Start server
CMD ["node", "api/current.js"]
