# syntax=docker/dockerfile:1

FROM node:22-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS development

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]

FROM development AS build

ARG VITE_API_URL
ARG VITE_GA4_MEASUREMENT_ID
RUN npm run build

FROM nginx:1.28-alpine AS runtime

ENV API_PROXY_TARGET=http://api:8000
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
