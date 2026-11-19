# Task 3 — separate scan service (Linux VPS)

Status in the authoring environment: **unit tests use a mocked container runtime; Docker integration NOT RUN because Docker is unavailable.** No helper/proxy/probe image or deployment has been built/executed here. Run the integration commands below on your server and send the complete test output before treating container isolation as verified.

The existing local 0.12.0 scanner remains active. With no service URL/key, new reports retain local findings/scores and show every additional deep tool as **incomplete / not configured**. The security page, downloaded Markdown and API metadata expose these states. No rule, weight, benchmark score function or package version changes in Task 3.

## What Task 3 enables

- HMAC-authenticated HTTP API and a Redis-backed leased queue with global/per-owner concurrency defaults 2/1; max 256 queued jobs and 10 active+queued jobs per owner. Atomic Lua operations claim/release logical slots; local global/per-owner slots additionally remain occupied until physical container cleanup finishes, so cancellation cannot create overlap; expired leases fail incomplete and stale finish tokens cannot overwrite them. Production requires Redis; the in-memory backend is a test fixture only.
- Ephemeral Docker runner with defaults: **1 CPU, 1 GiB memory, memory+swap capped at the same value, 256 pids, 300 seconds total per tool, 900 seconds for Git-history secret tools, 50 MiB combined stdout/stderr maximum**; non-root UID/GID 10001, read-only root, cap-drop ALL, no-new-privileges, default Docker seccomp, no Docker socket mounts and disabled container logging. Limits are administrator configuration, never request fields.
- Public/readable GitHub repositories only in this foundation. Clone happens inside a helper container, through a per-job internal network and a dedicated CONNECT proxy permitting only `github.com:443`. DNS is resolved/checked/pinned for that connection. Redirects are disabled. Code tools clone depth 1; gitleaks/trufflehog clone full history. Hooks, repository/global Git config, submodules and LFS smudge are disabled. No npm install or repository script runs.
- Clone/checkout takes place in a size-bounded tmpfs; directory entries, regular files, file sizes, total worktree bytes and .git bytes are validated before export and again on the host. Symlinks, hard-linked regular files and special files reject the input. The exported input stays in a private host tmpfs, is made read-only, then mounted read-only into a **network=none** scan container. Clone/proxy containers and their private network are removed before scanning. Resources and input workspaces are removed on success, failure, cancellation, timeout and overflow; cleanup failures are incomplete. A kernel flock permits one controller per work root. Before accepting work after restart, recovery removes all service-labelled orphan containers and private networks, then removes leftover job directories from the private tmpfs. Periodic deadline reaping also removes expired containers/networks; a cleanup failure stops admission and fails the service closed.

**Tool parsers and detection integrations are later Tasks 5/6/8.** This task includes fixed allowlisted command recipes and infrastructure. An absent image means not attempted/incomplete. Even an exit-0 container is incomplete with `parser_not_enabled_task3` until a reviewed output adapter is enabled in those later tasks. Raw tool stdout/stderr is bounded, discarded and never written to Redis, application DB, HTTP responses or LLM input. The integration probe is a trusted fixture, not a real Gitleaks/Semgrep detection result.

Active URL/Nuclei execution is deferred until Tasks 4/8 wire ownership and SSRF enforcement. Task 3 never launches a URL probe or claims a verified origin. Private GitHub tokens are not transferred by this foundation: private repository scans retain local GitHubReader behavior and report service access as incomplete until a dedicated authenticated clone path is added. Discovered credentials are never tested against a provider.

## Deployment topology

Use a **dedicated Ubuntu 24.04+ Linux VPS**, Node 24+, systemd, rootless Docker with cgroup v2, at least 8 GiB RAM for two default jobs, and enough image storage. The controller runs as host user `aegis-scan` UID 10001, using that user's rootless Docker CLI. It is intentionally not a container mounting a Docker socket. `docker-compose.scan-service.yml` runs Redis on an internal network with only `127.0.0.1:6379` published. An egress bridge is created for trusted GitHub proxy containers; repository clone containers only join private internal networks. No scan container has egress.

The controller binds a private/VPN interface and uses TLS. Firewall and application IP allowlisting both permit only the Worker address. Both machines need synchronized clocks because the HMAC window is 60 seconds. Run one controller systemd unit per dedicated VPS/Redis namespace; the launcher enforces a single active controller with Linux flock; deployment of an active/active multi-host control plane is outside this task.

### 1. Host prerequisites (administrator)

Install Docker from its official Ubuntu repository, including rootless extras. These commands assume a new dedicated VPS:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl unzip uidmap dbus-user-session slirp4netns xz-utils util-linux
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" "$VERSION_CODENAME" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras
sudo useradd --create-home --uid 10001 --shell /bin/bash aegis-scan
sudo loginctl enable-linger aegis-scan
# Use the dedicated rootless daemon rather than the system-wide daemon on this new VPS.
sudo systemctl disable --now docker.service docker.socket
```

Install the current Node 24 Linux x64 release from the official distribution, checking the downloaded tarball against its HTTPS-published checksum list (use `linux-arm64` on ARM):

```bash
mkdir -p /tmp/aegis-node24
cd /tmp/aegis-node24
curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
NODE_TARBALL=$(awk '$2 ~ /linux-x64.tar.xz$/ {print $2; exit}' SHASUMS256.txt)
test -n "$NODE_TARBALL"
curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$NODE_TARBALL"
sha256sum --check --ignore-missing SHASUMS256.txt
sudo install -d /opt/aegis-node
sudo tar -xJf "$NODE_TARBALL" -C /opt/aegis-node --strip-components=1
sudo ln -sf /opt/aegis-node/bin/node /usr/local/bin/node
sudo ln -sf /opt/aegis-node/bin/npm /usr/local/bin/npm
node --version
```

Unpack the delivered project so `/opt/aegis-audit/package.json` exists, then install **trusted control-service dependencies**, not dependencies of a scanned repository:

```bash
sudo unzip Aegis_Audit_Nextjs_Nodejs_Beta.zip -d /opt
sudo chown -R aegis-scan:aegis-scan /opt/aegis-audit
sudo install -d -o aegis-scan -g aegis-scan -m 0700 /var/lib/aegis-scan/jobs
# Raw clone/export data must stay in private ephemeral memory, not a durable checkout.
echo 'tmpfs /var/lib/aegis-scan/jobs tmpfs rw,nosuid,nodev,noexec,size=2G,mode=0700,uid=10001,gid=10001 0 0' | sudo tee -a /etc/fstab
sudo mount /var/lib/aegis-scan/jobs
sudo timedatectl set-ntp true
```

Use an adequately sized dedicated machine; disable swap on it or use encrypted swap so temporary source material does not spill unencrypted to disk. The service refuses a non-tmpfs, symlinked, incorrectly owned or non-private work root.

### 2. Rootless daemon and images (as aegis-scan)

```bash
sudo -iu aegis-scan
export XDG_RUNTIME_DIR=/run/user/10001
export DOCKER_HOST=unix:///run/user/10001/docker.sock
# useradd normally allocates these ranges; verify both contain at least 65536 IDs.
grep '^aegis-scan:' /etc/subuid /etc/subgid
dockerd-rootless-setuptool.sh install
systemctl --user start docker
docker info
cd /opt/aegis-audit
npm ci
npm run scan-service:images
```

The image script pulls official `node:24-alpine` / `redis:7-alpine`, resolves actual registry digests before build, builds the trusted helper/proxy/probe images, then records immutable local image IDs and upstream digests in private `services/scan-service/deploy-local/images.env`. It never invents pins. It also creates `aegis-scan-egress` if absent. No repository scan happens while images are built. The controller preflight requires rootless mode, cgroup v2 and reported memory/pids/CPU quota support; it refuses startup otherwise. Verify Docker reports the required controllers before proceeding.

### 3. Generate private configuration and start Redis

Replace only these three example addresses with your actual private/VPN values and DNS name. No real secret is embedded in this guide:

```bash
cd /opt/aegis-audit
SCAN_WORKER_IP=10.10.0.2 \
SCAN_BIND_HOST=10.10.0.3 \
SCAN_SERVICE_HOST=scan.internal.example \
npm run scan-service:configure

docker compose --env-file services/scan-service/deploy-local/images.env \
  -f docker-compose.scan-service.yml up -d redis
```

The configure script generates a random HMAC key, independent Redis password, hashed Redis ACL and a 90-day self-signed TLS certificate with the chosen DNS/IP SAN. It writes private `server.env`, `worker.env`, `integration.env` and TLS key files without printing secret values. It refuses to overwrite existing configuration so rotation is deliberate. The configuration directory is 0700; secret files are 0600. `users.acl` contains only a password hash. Redis data directory permissions support a non-root user under Docker user namespaces, inside the private parent directory. Renew TLS before 90 days and distribute the replacement public certificate to the Worker.

Create private DNS/hosts entries so the Worker resolves `scan.internal.example` to the service interface. Do not turn off TLS verification. Keep copies of environment files out of Git and build contexts; deploy-local is ignored by both.

### 4. Worker-only firewall (administrator)

On the dedicated VPS, use the actual Worker source IPv4 address below. Permit SSH before enabling UFW. The service port is native host Node, not a Docker-published API port:

```bash
sudo ufw allow OpenSSH
sudo ufw insert 1 allow from 10.10.0.2 to any port 7443 proto tcp
sudo ufw insert 2 deny 7443/tcp
sudo ufw enable
sudo ufw status numbered
```

Redis is loopback-only; do not publish 6379 externally. Also apply the same Worker-only rule in your VPS provider firewall. The service independently checks the socket's source address, ignoring forwarded-IP headers. An admin host that is not the Worker should receive a firewall denial; a request from the Worker without a valid HMAC receives 401.

### 5. Start the non-root controller

As `aegis-scan`:

```bash
cd /opt/aegis-audit
mkdir -p ~/.config/systemd/user
cp services/scan-service/deploy/aegis-scan.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now aegis-scan
systemctl --user status aegis-scan
journalctl --user -u aegis-scan --no-pager -n 50
```

The included unit disables core dumps, uses a private umask, and restarts on failure. It starts `npm run scan-service`, which loads only private server.env. There is no automatic fallback to in-memory production queue storage or to an unhardened Docker daemon.

### 6. Configure the existing Worker

Transfer **only** `worker.env` and the public `tls.crt` over your secure admin channel to the Worker. Do not transfer server.env, the TLS private key or the Redis password. Merge these settings into the Worker's existing protected `.env.local`:

```dotenv
SCAN_SERVICE_URL=https://scan.internal.example:7443
SCAN_SERVICE_HMAC_SECRET=<the-generated-shared-key-from-worker.env>
NODE_EXTRA_CA_CERTS=/absolute/worker/path/to/tls.crt
# Optional maximum queue+execution wait (milliseconds, maximum 3600000):
SCAN_SERVICE_WAIT_MS=2460000
```

Restart the existing Worker so Node loads the CA at process startup. Keep clocks synchronized on both machines. When configuration is absent or invalid, the local scanner continues and deep tools are incomplete. A configured service failure, rejected auth, malformed response, omitted tool, job failure or timeout cannot become a clean result. Cancellation and polling timeout send a signed cancel request; stale jobs cannot subsequently overwrite the result as ok. Remote statuses are namespaced as `scan-service/<tool>` in the normalizer, keeping the existing local OSV lookup status separate from OSV-Scanner.

## Exact verification commands to send back

Run as the non-root scan user after images/Redis setup. Integration uses actual Docker and actual Redis, including a read-only clone of public `octocat/Hello-World` (branch `master`) through the GitHub proxy. Set `SCAN_INTEGRATION_REPO` / `SCAN_INTEGRATION_BRANCH` for another authorized readable GitHub repository. Never push the fake-secret benchmark repository to GitHub.

```bash
cd /opt/aegis-audit
export DOCKER_HOST=unix:///run/user/10001/docker.sock
npm test
npm run test:benchmark
npm run typecheck
npm run test:integration > /tmp/aegis-task3-integration.log 2>&1
cat /tmp/aegis-task3-integration.log
```

**Integration was NOT RUN by the author.** The preflight exits 2 with NOT RUN if Docker or required image/Redis settings are absent; this is not a passing integration test. The suite checks real non-root/resource/readonly/network enforcement, timeout/output overflow and removal, GitHub-only proxy denial, shallow/full clone separation and cleanup, and actual Redis atomic concurrency/lease/stale-result behavior. Genuine Gitleaks/Semgrep/OSV/Nuclei detection correctness is not claimed by the fixture image.

## API and operational settings

`POST /scans`: signed JSON `{scanId, ownerId, kind:'repo'|'url', target, tools, branch?}`. ownerId is the application's authenticated owner ID supplied by the trusted Worker, not an end-user override. Tool names are exactly gitleaks/trufflehog/semgrep/osv/nuclei; unknown names return 400. User args/image/limits/other fields are ignored and never persisted. `GET /scans/:jobId` returns job status/results/toolStatus; lease tokens and queue request internals are not returned. `POST /scans/:jobId/cancel` requires a signed `{jobId}` body matching the path.

HMAC: `X-Timestamp` is Unix **milliseconds**, 13 decimal digits. `X-Signature` is lowercase hex HMAC-SHA256 over the exact bytes `timestamp + '.' + rawBody`; GET has an empty body. Both older and future timestamps outside ±60000 ms are rejected. POST submission replay signatures are reserved in Redis for 121 seconds. Use TLS and Worker-only networking; GET status authentication intentionally follows the plan's raw-body contract.

Administrator limit env vars: SCAN_CPUS, SCAN_MEMORY_BYTES, SCAN_PIDS, SCAN_TIMEOUT_MS, SCAN_HISTORY_TIMEOUT_MS, SCAN_MAX_OUTPUT_BYTES (capped at 50 MiB), SCAN_MAX_FILES, SCAN_MAX_REPO_BYTES, SCAN_MAX_FILE_BYTES, SCAN_MAX_HISTORY_BYTES, SCAN_GLOBAL_CONCURRENCY, SCAN_OWNER_CONCURRENCY. Defaults are listed above. Tool images use SCAN_IMAGE_GITLEAKS / TRUFFLEHOG / SEMGREP / OSV / NUCLEI, each an immutable digest/local image ID. Leave them unset in Task 3; enabling version-specific parsers/rules and trusting tool image contents belongs to their later tasks. Do not pass additional arguments from users or enable a networked scan phase.

Container cleanup after an unexpected shutdown can be inspected by the administrator with `docker ps -a --filter label=aegis.scan.service=v1`; the controller's deadline reaper removes expired containers and private networks. Startup recovery under the exclusive lock also removes unfinished source workspaces before claiming queued work. Do not use these labels for unrelated containers. Redis retains completed records for 24 hours; its AOF contains only validated metadata and safe tool results, not source or raw stdout. Source/history/export live in bounded ephemeral memory until cleanup. No raw output is sent to Ollama.

Official operational references: [Docker run limits](https://docs.docker.com/engine/containers/run/), [Docker rootless mode](https://docs.docker.com/engine/security/rootless/), [Docker Ubuntu install](https://docs.docker.com/engine/install/ubuntu/), [Redis RESP](https://redis.io/docs/latest/develop/reference/protocol-spec/).

## Task 4 network-layer SSRF policy

URL-scan/tool containers must use **Docker `--network=none`**, enforced by the runner, independently of the TypeScript guard. This is a deny-all network rule: private IPv4, metadata (`169.254.169.254`), IPv6 ULA/link-local, and public destinations are unreachable even if a URL slips through code validation. URL/Nuclei execution is still deferred, not enabled by Task 4. Do not connect a scan container to host/bridge/egress networks. Any future requirement for URL egress needs a separately reviewed policy-enforcing broker; do not relax this isolation to make a URL scan work.

The only egress-enabled job container today is the trusted GitHub-only CONNECT proxy. Clone helpers stay on their per-job internal network; scan steps stay network none. Host/rootful DOCKER-USER iptables examples are deliberately not used for rootless Docker, where they would not provide the claimed guarantee.

On your Docker-enabled server, `npm run test:integration` verifies actual network denial and NetworkMode=none, together with Task3's limits/cleanup/proxy/clone/Redis checks. This has **not been run in the authoring environment**. The Worker SSRF unit suite can be run separately with `npm run test:ssrf`.

## Task 5 — enable the two secret tools

Gitleaks 8.24.2 and TruffleHog 3.88.23 now have parsers. The updated image builder resolves the official version-tagged upstream images to actual digests, copies their binaries plus the trusted wrapper/default Gitleaks config into a non-root image, then records its immutable ID as SCAN_IMAGE_GITLEAKS and SCAN_IMAGE_TRUFFLEHOG. No digest or actual tool run was fabricated in the authoring environment.

As the dedicated scan-service user, update the project and run:

```bash
cd /opt/aegis-audit
export DOCKER_HOST=unix:///run/user/10001/docker.sock
npm ci
npm run scan-service:images
```

For a new installation, run the existing configure step afterward; it includes both image references. For an existing installation, copy **only** SCAN_IMAGE_GITLEAKS and SCAN_IMAGE_TRUFFLEHOG from deploy-local/images.env into the protected deploy-local/server.env, then restart `systemctl --user restart aegis-scan`. Do not overwrite existing HMAC/Redis/TLS settings or print them into a log. Restart the application's Worker after deploying its updated code.

The fixed wrapper checks each tool version. Repository mode scans history and working tree; directory mode scans working tree only. TruffleHog uses --no-verification, --no-verification-cache, --no-update and --log-level=2. It inspects bounded diagnostic JSONL in memory, rejects scan/Git errors even with exit 0 and requires a matching finished-scanning summary for every pass. No diagnostic values are echoed/persisted. Tool failures and rejected output remain incomplete. Semgrep/OSV/Nuclei parsers are not enabled by this task.

### Local fake-repository benchmark (separate process only)

Production HTTP does not accept local paths. The local runner requires BENCHMARK_MODE=1 and always refuses NODE_ENV=production. It validates files and mounts them read-only with network none. A local Git repository must have only the generated minimal core config; includes, worktree config, fsmonitor, diff drivers and other non-allowlisted config are rejected. This matters because this TruffleHog version drops GIT_CONFIG_* in some Git subprocesses; environment-only protection is insufficient. The trusted image also provides system-level hooks/protocol/ownership hardening.

Run the benchmark in its own non-production CLI process, not by enabling benchmark flags in the production service:

```bash
cd /opt/aegis-audit
export DOCKER_HOST=unix:///run/user/10001/docker.sock
npm run test:secrets
BENCHMARK_MODE=1 NODE_ENV=test npm run benchmark:secrets -- --target all --osv-offline --final --output benchmark/runs/task5-tools-final.json
```

The generator in benchmark/fixtures.ts creates the fake added-then-deleted key in two local commits at benchmark time. No nested .git is distributed, no fixture remote is added and nothing is pushed. The command refuses to claim a tool run when Docker/images are absent. Requested failed tools make secret quality unmeasured, never a clean zero. Keep real tool measurement separate from sanitized parser fixtures and the static reference benchmark. Do not run fixture-generating benchmark commands concurrently.

Task3's real integration (`npm run test:integration`) and Task4's three real-Chromium redirect tests remain pending your server/local logs. Parser mocks do not verify Docker enforcement or browser redirects.
