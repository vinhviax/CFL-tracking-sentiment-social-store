# Image for the API + in-process cron, replacing the Cloudflare Worker.
#
# node:22-slim (Debian), not alpine: @libsql/client loads a native binding, and glibc is
# the variant with the least to go wrong. Both stages share the base image so the binding
# built in the first stage is the right one for the second.
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# One bundle of our own TypeScript; dependencies stay external and are carried over as
# node_modules. Bundling instead of `tsc` because the source imports without file
# extensions ("./routes/admin"), which Node's ESM resolver rejects but esbuild resolves.
RUN npx esbuild src/node/entry.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --packages=external --outfile=dist/server.js

# Drop devDependencies (esbuild, wrangler, vitest, typescript) from the tree that ships.
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Read at startup by the migration runner (src/node/migrate.ts) — there is no
# `wrangler d1 migrations apply` here, so the schema is created from these files.
COPY migrations ./migrations

# LIBSQL_URL has no default on purpose: booting against an empty file would answer every
# request with "no data", which looks exactly like data loss. Set it in compose/Dokploy.
EXPOSE 8787
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/meta').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
