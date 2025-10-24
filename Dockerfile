FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js calendarService.js taskManager.js discovery.js healthRoutes.js metrics.js middleware.js ./

ENV PORT=80
EXPOSE 80

CMD ["npm", "start"]
