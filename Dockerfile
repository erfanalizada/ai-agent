FROM node:20-slim

# System deps
RUN apt-get update && apt-get install -y \
  git \
  curl \
  ca-certificates \
  bash \
  && rm -rf /var/lib/apt/lists/*

# Install Claude CLI (API mode)
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (claude CLI refuses --dangerously-skip-permissions as root)
RUN useradd -m claudeuser && mkdir -p /tmp/client-demo && chown claudeuser:claudeuser /tmp/client-demo

# Mark /tmp/client-demo as safe for git (ownership changes between root and claudeuser)
RUN git config --global --add safe.directory /tmp/client-demo
RUN su -s /bin/bash claudeuser -c "git config --global --add safe.directory /tmp/client-demo"

WORKDIR /app
COPY . .

RUN npm install

EXPOSE 3000
CMD ["node", "server.js"]
