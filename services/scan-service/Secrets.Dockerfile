ARG GITLEAKS_IMAGE
ARG TRUFFLEHOG_IMAGE
ARG NODE_IMAGE
FROM ${GITLEAKS_IMAGE} AS gitleaks
FROM ${TRUFFLEHOG_IMAGE} AS trufflehog
FROM ${NODE_IMAGE}
RUN apk add --no-cache git ca-certificates && git config --system --add safe.directory /workspace && git config --system core.hooksPath /dev/null && git config --system core.fsmonitor false && git config --system submodule.recurse false && git config --system protocol.allow never && git config --system protocol.file.allow always && git config --system protocol.https.allow never
COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=trufflehog /usr/bin/trufflehog /usr/local/bin/trufflehog
COPY services/scan-service/secret-step.mjs services/scan-service/secret-arguments.mjs services/scan-service/secret-diagnostics.mjs /app/
COPY services/scan-service/rules/gitleaks.toml /opt/aegis/gitleaks.toml
COPY services/scan-service/rules/GITLEAKS-LICENSE /opt/aegis/GITLEAKS-LICENSE
RUN touch /opt/aegis/empty.gitleaksignore && chmod -R a+rX /opt/aegis /app
USER 10001:10001
ENTRYPOINT ["node","/app/secret-step.mjs"]
