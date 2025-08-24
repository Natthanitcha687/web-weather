FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY public ./public
CMD ["serve","-s","public","-l","3000"]
