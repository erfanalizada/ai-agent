FROM node:20-slim

# System deps
RUN apt-get update && apt-get install -y \
  git \
  curl \
  ca-certificates \
  bash \
  && rm -rf /var/lib/apt/lists/*

# Install Claude CLI (API mode)
RUN npm install -g @anthropic-ai/claude

WORKDIR /app
COPY . .

RUN npm install

EXPOSE 3000
CMD ["node", "server.js"]
