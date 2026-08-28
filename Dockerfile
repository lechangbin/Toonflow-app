# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base

WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    npm config set registry https://registry.npmmirror.com/ && \
    yarn config set registry https://registry.npmmirror.com/

FROM base AS build

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY data ./data

RUN yarn build

FROM base AS production-dependencies

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive --production=true && \
    yarn cache clean

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=prod \
    HOST=0.0.0.0 \
    PORT=10588 \
    DATA_DIR=/app/runtime-data \
    SEED_DATA_DIR=/app/seed-data \
    OSSURL=http://localhost:10588

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/data/serve/app.js ./data/serve/app.js
COPY --from=build /app/build/initRuntimeData.js ./bin/initRuntimeData.js
COPY --from=build /app/data/assets ./seed-data/assets
COPY --from=build /app/data/models ./seed-data/models
COPY --from=build /app/data/promptProfiles ./seed-data/promptProfiles
COPY --from=build /app/data/skills ./seed-data/skills
COPY --from=build /app/data/vendor ./seed-data/vendor
COPY --from=build /app/data/web ./seed-data/web
COPY --from=build /app/data/version.txt ./seed-data/version.txt
COPY docker/entrypoint.sh /usr/local/bin/toonflow-entrypoint

RUN chmod 0755 /usr/local/bin/toonflow-entrypoint && \
    mkdir -p /app/runtime-data && \
    chown -R node:node /app

USER node

VOLUME ["/app/runtime-data"]
EXPOSE 10588

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

ENTRYPOINT ["toonflow-entrypoint"]
CMD ["node", "data/serve/app.js"]
