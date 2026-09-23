FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=4173 \
    HOST=0.0.0.0

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY src ./src
COPY mcp ./mcp
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 4173

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4173/health >/dev/null || exit 1

CMD ["node", "server.mjs"]
