FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
ENV NOVA_DATA_DIR=/var/data
RUN mkdir -p /var/data
EXPOSE 3000
CMD ["node","server.js"]
