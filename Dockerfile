FROM node:20

RUN apt-get update && apt-get install -y git curl

# Install Claude CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

WORKDIR /app
COPY . .

RUN npm install

EXPOSE 3000
CMD ["node", "server.js"]
