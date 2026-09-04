# Static bundle + nginx, replacing Cloudflare Pages.
#
# VITE_API_BASE is baked in at build time (see src/api/client.js), so the API URL is a
# build argument, not a runtime environment variable — changing it means rebuilding.
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
