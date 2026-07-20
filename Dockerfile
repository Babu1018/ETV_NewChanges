# ── Stage 1: Build ─────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src

ARG VITE_API_AUTH_KEY=changeme
ARG VITE_ASR_API_BASE_URL=/asr
ARG VITE_TTS_API_BASE_URL=/tts
ARG VITE_AUTH_API_BASE_URL=/api
ENV VITE_API_AUTH_KEY=$VITE_API_AUTH_KEY \
    VITE_ASR_API_BASE_URL=$VITE_ASR_API_BASE_URL \
    VITE_TTS_API_BASE_URL=$VITE_TTS_API_BASE_URL \
    VITE_AUTH_API_BASE_URL=$VITE_AUTH_API_BASE_URL

RUN npm run build

# ── Stage 2: Serve (non-root nginx) ────────────────────────────
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1