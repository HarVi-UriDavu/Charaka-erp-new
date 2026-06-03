FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY database ./database
COPY docs ./docs
RUN mkdir -p data backups
ENV PORT=4173
EXPOSE 4173
CMD ["node", "server/index.js"]
