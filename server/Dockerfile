# The live server on Cloud Run: `gcloud run deploy ... --source server`
# (see DEPLOY-CLOUD-RUN.md). Node 24 runs the TypeScript directly (type
# stripping, on by default since Node 22.18), so there is no build step and no
# TypeScript compiler in the image. All settings come from environment
# variables; the Gemini key comes from Secret Manager. Nothing secret is copied
# in (.dockerignore keeps out .env files, work/ and node_modules).

FROM node:24-slim

# Scratch space for the usage ledger. Cloud Run's disk is memory and is wiped
# when the instance stops (PHI_LEDGER_PATH can point at a mounted bucket instead).
ENV NODE_ENV=production
ENV PHI_SERVER_WORK=/tmp/phi-work

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

# Cloud Run sets PORT (8080) and K_SERVICE; the server listens on 0.0.0.0:$PORT there.
EXPOSE 8080
CMD ["node", "src/main.ts"]
