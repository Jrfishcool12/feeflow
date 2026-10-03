FROM node:22-slim
# build tools in case better-sqlite3 has no prebuilt binary for this platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production DB_PATH=/data/goodcall.db PORT=8787
# SQLite lives in /data: attach a persistent volume there (Railway: a Volume mounted at /data).
# No VOLUME line: Railway rejects it and uses its own volumes.
EXPOSE 8787
# Run node directly (not through npm/npx), so a normal stop on redeploy exits cleanly instead of looking like a crash.
CMD ["node", "--import", "tsx", "src/index.ts"]
