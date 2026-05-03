# Tether QVAC — OpenAI-compatible local LLM HTTP server
# Docs: https://docs.qvac.tether.io/http-server/
#
# IMPORTANT: @qvac/sdk requires Node.js >= v22.17.
# node:22 is the minimum — node:20 causes the SDK import to fail silently,
# making every model constant appear "unknown" at startup.
FROM node:22-bookworm-slim
WORKDIR /app

# wget                — compose healthcheck (GET /v1/models)
# libatomic1          — rocksdb-native (transitive dep of corestore via bare-*)
# libvulkan1          — Vulkan loader required by @qvac/llm-llamacpp
# mesa-vulkan-drivers — Mesa lavapipe software Vulkan ICD; mandatory in headless/
#                       Docker environments (no GPU) so llama.cpp can initialise
#                       the Vulkan backend and fall back to CPU inference.
#                       Without this the loader finds no device and crashes.
#                       See: https://docs.qvac.tether.io/sdk/getting-started/installation
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget libatomic1 libvulkan1 mesa-vulkan-drivers \
  && rm -rf /var/lib/apt/lists/*

# @qvac/sdk imports bare-* packages even in Node.js mode — they are required
# peer deps, not Bare-runtime-only. See package.json for the exact set.
COPY docker/qvac/package.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Config declares which model aliases the HTTP server can load.
# Alias "solagent-parser" must match QVAC_MODEL in .env.devnet
COPY docker/qvac/qvac.config.json ./

EXPOSE 11434

# -H 0.0.0.0  — listen on all interfaces (required inside Docker)
# -c           — explicit config path (avoids auto-detect ambiguity)
CMD ["npx", "qvac", "serve", "openai", "-H", "0.0.0.0", "-p", "11434", "-c", "/app/qvac.config.json"]
