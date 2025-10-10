# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install only production deps
COPY package*.json ./
# If you have package-lock.json, keep npm ci (faster, reproducible)
RUN npm ci --omit=dev

# Copy the app code
COPY index.js calendarService.js taskManager.js ./

# Default port; override with -e PORT=xxxx
ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
