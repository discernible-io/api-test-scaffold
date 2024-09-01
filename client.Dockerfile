# Client Dockerfile
FROM node:18

# Install tini
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

WORKDIR /app

# Copy configuration files
COPY 1ab02c4384b1285d0aa8e4b07ccda3d83e278cd4294a822348a14a512f9884aa.json /home/icarus35/.near-credentials/testnet/1ab02c4384b1285d0aa8e4b07ccda3d83e278cd4294a822348a14a512f9884aa.json
COPY roditconfig.client /etc/rodit/roditconfig.client

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Expose port
EXPOSE 8081

# Use tini as entrypoint
ENTRYPOINT ["/tini", "--"]

# Run the application
CMD ["node", "app.js"]
