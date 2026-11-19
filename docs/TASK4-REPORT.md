# Task 4 — SSRF guard

Implementation report, 2026-11-17. Base: Task3 foundation 88af5ad. Version remains 0.12.0. No Task5 started.

The canonical implementation stays in src/lib/network.ts, reusing existing ipaddr.js address classification, WHATWG URL normalization, DNS deadline/pinning, decompression and response limits. worker/ssrf-guard.ts exposes resolveAndValidate/safeFetch. safeFetchPage retains the existing HttpPage interface so no detector/scorer needs to change.

## Changed outbound call sites

| File / call site | Guard path and preserved behavior |
|---|---|
| src/lib/network.ts — resolveAndValidate | Syntax/protocol/port checks, public IP classification, validate every DNS answer, reject invalid address families, select one validated address |
| src/lib/network.ts — sendValidated | One pinned HTTP/TLS connection; original Host and explicit domain SNI, no agent/DNS reuse or automatic redirects; bounded bytes/decompression |
| src/lib/network.ts — safeFetchPage / safeFetch | Shared validated transport; Response interface defaults guarded follow, max 3; HttpPage interface defaults manual for existing API callers |
| src/lib/network.ts — collect | Validate each redirect before another request; preserve same-origin and crawl allowUrl restrictions, max 3 |
| src/worker.ts — HTTP fallback, normal HTTP page collector, fetchDiscovery callback | collectSafeHttp → collect → safeFetchPage → resolveAndValidate |
| src/lib/jobs.ts — runJob default collector | collectSafeHttp; robots.txt/sitemap/nested sitemap/page/script collection use the supplied guarded collector; custom fixture adapters remain test-only choices |
| src/lib/browser.ts — createBrowserCollector default transport and CDP-routed resources | safeFetchPage for documents/scripts/fetch/XHR/assets, with native browser network blocked through the existing dead proxy; each paused redirect uses the same guarded path |
| src/lib/browser-routing.ts — installGuardedRoutes and resource-policy.ts redirect chain | CDP Fetch request-stage interception includes redirectedRequestId; reject the fourth hop or an unknown parent before the resource handler. Fulfill responses through CDP so Chromium retains the real final URL, relative base and cookie behavior |
| src/lib/auto-api-http.ts — runAutomaticApiHttp HEAD/OPTIONS default transport | safeFetchPage, manual redirects and all existing checks unchanged; no per-origin ownership addition |
| src/lib/api-tests.ts — verifyApiConfig proof GET | safeFetchPage; existing proof and identity/origin checks retained, no redirects followed |
| src/lib/api-tests.ts — runApiTests test-account GET matrix | safeFetchPage, existing authorization/preconditions/read-only semantics retained |
| src/lib/repository/runtime-security.ts — runRuntimeSecurity default loader | collectSafeHttp and per-hop guarded transport; existing project ownership checks retained |
| src/lib/repository/github.ts — GitHubReader default transport | safeFetchPage on constructed fixed api.github.com URLs, no redirect following, existing token/SHA/branch constraints retained |
| src/lib/repository/osv.ts — fixed OSV querybatch transport | safeFetchPage, existing fixed POST allowlist and body/response bounds retained |

`src/lib/api-discovery.ts` is a local source/AST parser, not a network client. Its discovered URLs go through validateTarget; actual discovery traffic is handled by the guarded Worker discovery collector/browser routes and runAutomaticApiHttp above. `src/lib/crawler.ts` likewise parses/normalizes robots/sitemap/link data; the fetch occurs in jobs/Worker. Neither parser gained a network operation.

The existing site ownership HTTP proof in src/app/api/[...path]/route.ts already calls collect and inherits the same guard; it was not independently rewritten. requestResource is a compatibility alias to safeFetchPage, not another HTTP implementation.

Raw fetch exceptions: Ollama `/api/chat` and the HMAC scan-service control client use administrator environment-configured base URLs and redirect:error. They are not user-influenced scan destinations and require private/VPN reachability. Browser client-api fetches are same-origin UI calls, not Worker outbound probes; browser-selfcheck's fetch is fixture page source intercepted by the resource router. The scan service still does not execute user URL scans; Git clone only uses the existing GitHub-only proxy.

## Tests before implementation

First run: `node --import tsx --test worker/ssrf-guard.test.ts` — **10 failed, 0 passed**. The old code already blocked many private/encoded address forms, but used generic Error and lacked the required resolveAndValidate/safeFetch interfaces. The red result is not evidence that all those private addresses were previously reachable. Separate later RED tests covered explicit original SNI and the browser redirect chain cap, followed by GREEN runs.

Required cases: loopback; 10/172/192 private ranges; metadata; IPv6 loopback/link-local/ULA; decimal/octal/hex and shortened IPv4; mapped private IPv6; non-http schemes/odd ports; internal redirect; rebound DNS on a subsequent hop; normal public HTTPS positive. Transport interception proves exactly one resolver call per hop and use of the first validated public IP while Host/SNI stay original; a second private DNS answer is never used by the socket. Mixed DNS answers fail closed.

Additional tests cover standard Response output, max-three redirects, credential stripping on cross-origin follow, explicit origin restrictions and collector/browser redirect limits. No real external target was probed by these deterministic tests.

## Verification

| Verification | Result |
|---|---|
| `npm test` | **261 passed**, 0 failed |
| `npm run test:ssrf` | **25 passed**, 0 failed (address/HTTP suite; CDP adapter additionally runs under npm test) |
| `node --import tsx --test worker/*.test.ts` | **19 passed**, 0 failed (guard + CDP adapter) |
| `npm run test:benchmark` | **21 passed**, 0 failed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| Frozen Task2.5 detector/redaction hashes, score modules, version | Unchanged |
| `npm run test:browser` | **3 failed before browser startup**, 0 passed: environment denies Chromium `socket()` with EPERM. No browser integration success claimed. |

The failing browser tests are: `real Chromium renders SPA scripts and API data, runs axe, and blocks writing/private resources`; `real Chromium redirect routes stop before hop four or an internal target`; `real Chromium public redirect keeps final document URL and relative script base`. They are separate from the green unit suite. The installed Chromium executable exists but the environment blocks its startup; no protection was weakened to bypass that restriction.

## Final review corrections

1. Installed Playwright routes do not receive subsequent redirect hops. The initial route-chain helper alone was insufficient. Replaced context.route with a bounded CDP Fetch request-stage adapter, which never calls Fetch.continueRequest and routes every paused hop through the existing guard. A new CDP event-sequence unit test failed before the adapter existed, then passed: initial + three redirects fulfilled, fourth blocked. Unknown redirect parents fail closed. Three real-browser cases are provided; runtime validation is pending the server run above. Reference: [official CDP Fetch event/fulfillment contract](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/).
2. Reproduced a real Response construction error on multiline Set-Cookie with a failing test. Cookie headers now append individually; the socket mock also exercises two raw Set-Cookie header values. Both tests pass.

Deferred minor from review: the new Response facade retains native `redirected=false` after internally followed redirects, although its url is the final validated URL. Existing HttpPage consumers do not use this metadata; a future Response consumer should use the final URL until metadata is extended. No SSRF/ownership decision depends on it.

## Benchmark — unchanged

`BENCHMARK_MODE=1 NODE_ENV=test npm run benchmark -- --target all --osv-offline --final --output benchmark/task4-final-offline.json`

| Category | Recall Task3 → Task4 | Precision Task3 → Task4 | FP Task3 → Task4 |
|---|---:|---:|---:|
| secret | 71.43% → 71.43% | 100% → 100% | 0 → 0 |
| api | 50% → 50% | 100% → 100% | 0 → 0 |
| code | 100% → 100% | 100% → 100% | 0 → 0 |
| dependency (offline fixture) | 100% → 100% | 100% → 100% | 0 → 0 |
| config | 80% → 80% | 100% → 100% | 0 → 0 |

Exact unordered finding sets match Task3. Overall 16/21 expected, recall 76.19%, precision 100%, 5 misses, 0 FP. Original dev negatives 0 FP; new sealed holdout negatives 0 FP. No tuning from holdout data. Offline dependency measurement is fixture integration, not a live OSV database claim. No detector, expected manifest or scoring logic was edited.

| Target | Duration / state |
|---|---:|
| seeded | 953 ms |
| clean-marketing | 43 ms |
| clean-docs | 62 ms |
| clean-portal | 79 ms |
| clean-holdout-cache | 51 ms |
| clean-holdout-frame | 54 ms |
| clean-holdout-cms | 71 ms |
| Juice Shop / NodeGoat / DVWA | NOT RUN, Docker unavailable; quality unmeasured |

## Rulings / scope boundaries

- Reuse network.ts and expose a worker facade rather than maintain duplicate IP policy. Compatibility adapters preserve HttpPage consumers. Risk if a future caller introduces a new transport: it must join the same guard; this report inventories current paths.
- Keep administrator infrastructure endpoints private/VPN-capable because they are not scan URLs. Risk if their base configuration becomes user-editable: it requires a separate authenticated infrastructure policy; no such user-controlled base exists here.
- Use CDP Fetch instead of Playwright route for redirects, preserving browser URL/base semantics without allowing native egress. Risk: actual installed-browser behavior still needs the provided server integration tests because authoring Chromium startup is blocked.
- Automatic API per-origin ownership remains absent, as explicitly deferred to Task7. SSRF validation does not authorize probing another public origin.

## Results still needed from your Task3 server

After the exact deployment steps in [SCAN-SERVICE.md](SCAN-SERVICE.md), run as the dedicated non-root user:

```bash
cd /opt/aegis-audit
export DOCKER_HOST=unix:///run/user/10001/docker.sock
npm run test:integration > /tmp/aegis-task3-integration.log 2>&1
cat /tmp/aegis-task3-integration.log
```

Still needed: **real rootless Docker/cgroup limits/non-root/readonly enforcement; network-none denial; timeout/output-overflow cleanup; GitHub-only proxy rejection; actual shallow versus full-history clone and removal; real Redis atomic concurrency, lease expiry and stale result rejection**. Task3 remains FOUNDATION/mock-verified until those results arrive.

Additionally, on a server with Chromium permitted to launch:

```bash
npm run test:ssrf
TEST_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser > /tmp/aegis-task4-browser.log 2>&1
cat /tmp/aegis-task4-browser.log
```

Use the actual installed Chromium executable path if different. Send both logs after removing any secrets from additional diagnostics. Task4 stops here; Task5 not started.
