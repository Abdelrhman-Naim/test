ARG NODE_IMAGE
FROM ${NODE_IMAGE}
RUN apk add --no-cache git ca-certificates
WORKDIR /app
COPY services/scan-service/clone-step.mjs services/scan-service/repo-guard.mjs /app/
USER 10001:10001
ENTRYPOINT ["node","/app/clone-step.mjs"]
