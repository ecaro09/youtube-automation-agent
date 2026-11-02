FROM node:20-bookworm-slim

# ffmpeg renders the Shorts; DejaVu provides the caption font.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p logs data output

ENV NODE_ENV=production
ENV PORT=3456

EXPOSE 3456

CMD ["node", "index.js"]
