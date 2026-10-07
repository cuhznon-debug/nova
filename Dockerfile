FROM node:22-bookworm-slim
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
ENV NOVA_DATA_DIR=/app/backend/data
RUN mkdir -p /app/backend/data
EXPOSE 3000
CMD ["node","backend/server.js"]
