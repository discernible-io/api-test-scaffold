# Node 20 has no CVE-2026-111497 fix. 22.23.4 is the fixed 22.x line.
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

# Install tini for Alpine
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-static /tini
RUN chmod +x /tini

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies with extra error handling
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /root/.npm/_cacache

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