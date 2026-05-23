FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p logs data

ENV NODE_ENV=production
ENV PORT=3456

EXPOSE 3456

CMD ["node", "index.js"]
