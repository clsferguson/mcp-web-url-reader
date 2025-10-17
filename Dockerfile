FROM node:20-alpine

WORKDIR /app

# Install curl (used by the tool handler)
RUN apk add --no-cache curl

# Copy minimal files and install production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src

# Runtime configuration
ENV NODE_ENV=production
ENV INTERNAL_PORT=8080
ENV CUSTOM_PREFIX=""

EXPOSE ${INTERNAL_PORT}

CMD ["npm", "start"]