FROM node:18-alpine

WORKDIR /app

RUN npm init -y && npm install express

COPY server.js ./
COPY public/ ./public/

EXPOSE 8000

CMD ["node", "server.js"]
