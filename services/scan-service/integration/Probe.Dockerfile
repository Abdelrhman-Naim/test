ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY services/scan-service/integration/probe.mjs /app/probe.mjs
COPY services/scan-service/integration/probe.mjs /app/secret-step.mjs
RUN cp /app/probe.mjs /usr/local/bin/gitleaks && cp /app/probe.mjs /usr/local/bin/semgrep && chmod 555 /usr/local/bin/gitleaks /usr/local/bin/semgrep
USER 10001:10001
ENTRYPOINT ["node","/app/probe.mjs"]
