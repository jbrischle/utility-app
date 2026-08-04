# Uses Node's built-in `node:sqlite` and native TypeScript type-stripping (both
# available and unflagged on Node 24+), so no native build toolchain and no
# separate compile step are required — the slim image runs the .ts entrypoint.
FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/meters.db

EXPOSE 3000

# The SQLite file lives on a mounted volume so data survives container restarts.
VOLUME ["/data"]

CMD ["node", "src/server.ts"]
