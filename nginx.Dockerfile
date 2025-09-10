FROM docker.io/nginx:mainline-alpine

RUN apk add --no-cache openssl &&     rm /etc/nginx/conf.d/default.conf &&     mkdir -p /app/certs

COPY nginx/nginx.conf /etc/nginx/nginx.conf

RUN chown -R nginx:nginx /etc/nginx/nginx.conf /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /app && \
    mkdir -p /app/logs && \
    chown -R nginx:nginx /app/logs

USER nginx
EXPOSE 3444

CMD ["nginx", "-g", "daemon off;"]
