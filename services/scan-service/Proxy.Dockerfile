ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY services/scan-service/github-proxy.mjs /app/
USER 10001:10001
ENTRYPOINT ["node","/app/github-proxy.mjs"]
