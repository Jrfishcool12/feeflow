# For hosting outside Vercel. BACKEND_URL is baked in at build time (Next.js rewrites).
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG BACKEND_URL
ARG SITE_URL
ENV BACKEND_URL=$BACKEND_URL SITE_URL=$SITE_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
