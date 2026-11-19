# Task 3 — separate scan service

Date: 2026-11-10. Application version stays **0.12.0**. Task 4 has not started.

Implemented foundation and Worker integration; **Docker/Redis runtime integration NOT RUN** because Docker is unavailable in the authoring environment. The Docker preflight exited **2**, explicitly NOT RUN, rather than reporting a pass. No deployment, image build or genuine external-tool detection result is claimed.

## Delivered

- HMAC API (±60s timestamp, exact raw bytes), Worker source-IP allowlist, submit replay protection, bounded request/response handling, fixed tool allowlist and ignored user arguments/images/limits.
- Redis leased queue with global/per-owner concurrency. Physical admission limits remain held through container cleanup even when logical leases are cancelled/expired. Cleanup failure halts admission.
- Non-root/rootless Docker runner: CPU 1, memory 1 GiB, pids 256, 300s/tool or 900s/history-secret tool, 50 MiB combined output cap, read-only root, dropped capabilities, no-new-privileges, no socket mount.
- Containerized Git clone: GitHub-only HTTPS egress proxy, no redirects/hooks/submodules/LFS or repository installs/scripts; shallow non-secret tools and full history for secret tools. Validated export to private host tmpfs, symlink/hardlink/special-file rejection, file count and byte caps. Scan containers use network none and read-only source mounts.
- Kernel flock singleton; startup orphan container/network/workspace recovery before admission; deadline reaping and cancellation/timeout cleanup.
- Existing local scanner retained. Absent/invalid/unavailable service produces explicit deep-tool incomplete states in UI, API metadata and Markdown. Local OSV lookup status stays separate from remote OSV-Scanner.
- Deployment scripts, compose, non-root systemd unit, TLS/HMAC/Redis configuration generation, Worker-only firewall instructions in [SCAN-SERVICE.md](../docs/SCAN-SERVICE.md). No real secret is included.

## Measured checks

| Command/check | Result here | Scope |
|---|---|---|
| `npm test` | 242 passed, 0 failed | Existing app/normalizer boundaries plus service/Worker tests |
| `npm run test:scan-service` | 24 passed, 0 failed | Mock runtime + real local HTTP, in-memory test queue, RESP codec |
| `npm run test:benchmark` | 21 passed, 0 failed | Benchmark harness contracts and fixture safety |
| `npm run typecheck` | Passed | TypeScript, including separate integration suite |
| `npm run build` | Passed | Next.js production build |
| `npm run test:integration` | **NOT RUN**, preflight exit 2 | Docker missing; no container/Redis integration pass |
| Task 2.5 frozen rule/redaction hashes | All unchanged | No detector or redaction tuning |
| `git diff --check` | Passed | Whitespace/conflict sanity |

Required mocked tests cover missing/old/future HMAC signatures, exact 60-second boundary, unknown tool rejection, ignored user args, fixed container flags, timeout/hung runtime incomplete, output overflow incomplete, symlink rejection, size/count protection, network/clone history specifications and cleanup. HTTP tests exercise signed submissions, replay rejection, safe API shape and configured Worker polling. Client tests reject contradictory success fields, retain local fallback and render incomplete reports.

A lifecycle regression test first failed with **2 scans instead of 1** while a cancelled owner's cleanup was held. After physical admission gating, it passed. Recovery and fail-closed cleanup tests also pass. Final independent review found no additional critical/important issue outside the addressed lifecycle/startup defects. Container enforcement and Redis Lua semantics remain for the real integration run.

## Benchmark comparison

Final measurement command (same frozen cases and offline OSV fixture as Task 2.5):

```bash
BENCHMARK_MODE=1 NODE_ENV=test npm run benchmark -- --target all --osv-offline --final --output benchmark/task3-final-offline.json
```

| Category | Task 2.5 recall | Task 3 recall | Precision before → after | False positives before → after |
|---|---:|---:|---:|---:|
| secret | 71.43% | 71.43% | 100% → 100% | 0 → 0 |
| api | 50.00% | 50.00% | 100% → 100% | 0 → 0 |
| code | 100% | 100% | 100% → 100% | 0 → 0 |
| dependency, offline fixture | 100% | 100% | 100% → 100% | 0 → 0 |
| config | 80.00% | 80.00% | 100% → 100% | 0 → 0 |

Exact finding sets and category metrics match the Task 2.5 final report. Finding ordering and run durations may differ. Overall: 16/21 expected findings, recall 76.19%, precision 100%, 5 misses, 0 FP. These are small fixture results, not production detection guarantees. Offline dependency results do not claim a live OSV scan.

| Target | Result | Duration |
|---|---|---:|
| seeded | Completed | 727 ms |
| clean-marketing | Completed, 0 FP | 32 ms |
| clean-docs | Completed, 0 FP | 52 ms |
| clean-portal | Completed, 0 FP | 47 ms |
| clean-holdout-cache | Final only, 0 FP | 46 ms |
| clean-holdout-frame | Final only, 0 FP | 44 ms |
| clean-holdout-cms | Final only, 0 FP | 48 ms |
| Juice Shop | NOT RUN: Docker unavailable | Unmeasured |
| NodeGoat | NOT RUN: Docker unavailable | Unmeasured |
| DVWA | NOT RUN: Docker unavailable | Unmeasured |

Dev negatives: 0 FP. New holdout negatives: 0 FP, separately reported, with no rule tuning. Expected files, scoring and source fixtures were not changed.

## Run on your server

Follow the exact administrator and non-root setup in [docs/SCAN-SERVICE.md](../docs/SCAN-SERVICE.md), including rootless Docker/cgroup v2, private tmpfs, Node 24, TLS, firewall and clock synchronization. Then, as the dedicated non-root user:

```bash
cd /opt/aegis-audit
export DOCKER_HOST=unix:///run/user/10001/docker.sock
npm ci
npm run scan-service:images
# Substitute your actual private/VPN addresses and DNS name:
SCAN_WORKER_IP=10.10.0.2 SCAN_BIND_HOST=10.10.0.3 SCAN_SERVICE_HOST=scan.internal.example npm run scan-service:configure
# configure refuses overwriting existing settings; do not rerun to rotate implicitly.
docker compose --env-file services/scan-service/deploy-local/images.env -f docker-compose.scan-service.yml up -d redis
npm test
npm run test:benchmark
npm run typecheck
npm run test:integration > /tmp/aegis-task3-integration.log 2>&1
cat /tmp/aegis-task3-integration.log
```

The separate real integration suite checks actual Docker non-root/cgroup/resource/readonly/network enforcement, timeout/overflow/removal, GitHub-only proxy rejection, shallow/full actual clone separation with cleanup and real Redis atomic concurrency/lease/stale-result behavior. It uses a trusted probe fixture image, not genuine scanner detection output. Send the complete integration output, with any infrastructure secrets removed if you add your own diagnostics.

## Explicit boundaries

Tool output parsers and real detection integrations remain Tasks 5/6/8. In Task 3, absent images are not attempted; even exit 0 with unparsed output is incomplete. Raw output is bounded and discarded before API/DB/Redis/LLM boundaries. URL/Nuclei execution awaits ownership/SSRF work in Tasks 4/8; no URL probe is enabled here. Private GitHub scans retain local GitHubReader behavior; tokens are not transferred to this service in Task 3. No discovery credential is tested with a provider. These states are visible and never converted into clean results.

Stop point: Task 3 delivered with mocked verification; real Docker validation awaits the user's run. No Task 4 work is authorized by this report.
