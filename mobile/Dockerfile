# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

ENV EXPO_NO_TELEMETRY=1 \
    EXPO_UNSTABLE_HEADLESS=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

EXPOSE 8081

CMD ["npm", "start", "--", "--port", "8081"]
