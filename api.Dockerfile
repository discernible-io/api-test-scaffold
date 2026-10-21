# Pin by digest for reproducible builds (node:20-alpine index, 2026-04-15).
FROM docker.io/library/node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

# Install tini for Alpine — pin release and verify checksum (supply-chain).
ENV TINI_VERSION=v0.19.0
ENV TINI_SHA256=c5b0666b4cb676901f90dfcb37106783c5fe2077b04590973b885950611b30ee
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-static /tini
RUN echo "${TINI_SHA256}  /tini" | sha256sum -c - \
    && chmod +x /tini

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies with extra error handling
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /root/.npm/_cacache

# Alpine OpenSSL floor + strip npm (node-alpine-cve-patch-plan)
RUN apk update && apk upgrade --no-cache \
 && apk add --no-cache 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0' \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy application files
COPY . .

# Create necessary directories for data and logs
RUN mkdir -p /app/data /app/logs

# Create non-root user for better security (Alpine syntax)
RUN adduser -D -H -s /sbin/nologin nodeuser && \
    chown -R nodeuser:nodeuser /app

USER nodeuser

EXPOSE 8080

ENTRYPOINT ["/tini", "--"]

# Fix the path to point to src/app.js
CMD ["node", "src/app.js"]
