# Task 5 — secrets detection

Task5 only; base79583a0; version0.12.0 unchanged. Real Chromium redirect handling remains NOT VERIFIED. Docker secret tools have not run here. Parsers use sanitized upstream recorded-format fixtures from the pinned versions, with all key values replaced by fake-only data; these fixtures are not tool detection measurements.

## Delivered

- parseGitleaks / parseTrufflehog with strict JSON/JSONL validation and redaction before returned results. Pinned format provenance: services/scan-service/tools/fixtures/README.md. Gitleaks8.24.2, TruffleHog3.88.23.
- Trusted version-checked wrapper plus digest-resolving secret image build. Both working tree and full Git history for repository mode. Read-only/network-none tool phase; no hooks/submodules/LFS/target script execution or key verification.
- Local benchmark-only runner, OFF by default and always refused in production; no local-path HTTP option. Runtime-generated fake Git history stays local.
- Real service runner parses only these two tools; malformed/unavailable/timeout/truncated tool states stay incomplete. New sources go through the real Worker normalizer into platform findings, per-source detail tables and Markdown.
- Frontend JS/HTML bundle scan and NEXT_PUBLIC misuse, including local service_role JWT decoding. Existing AST/regex rules, score modules and version remain unchanged. Same-location legacy aggregate overlaps retain all detailed source fingerprints while rendering one issue.

## Tests-first evidence and verification

Verified on 2026-11-19:

| Command / check | Result | Boundary |
| --- | --- | --- |
| `npm test` | 284 passed, 0 failed | Unit / fixture / mocked runtime; includes real application DB/API boundary test |
| `npm run test:secrets` | 23 passed, 0 failed | Subset of the above, not 23 additional tests |
| `npm run test:benchmark` | 23 passed, 0 failed | Includes unavailable-tools quality and real CLI argument handling |
| `npm run typecheck` | Passed | TypeScript |
| `npm run build` | Passed | Next.js production build |
| Docker secrets benchmark | **NOT RUN**, preflight exit 2 | No Docker binary/server; no real tool detection measurement |
| Task 3 real Docker/Redis integration | **NOT RUN** | Requires your server |
| Task 4 three real-Chromium redirect cases | **NOT VERIFIED** | Requires your local/server log |

Tests-first sequence: initial parser/bundle imports failed as missing; runner test failed incomplete !== ok; Worker rendering failed 0 !== 1; overlap test failed 2 !== 1. Review regressions were reproduced before fixes: TruffleHog exit-0 error diagnostics, unsafe local Git config, URL overlap duplication and public-property/assignment handling. Final regressions covered non-secret category preservation and unresolved public values (no invented fingerprint). Benchmark availability first failed completed !== partial; its CLI test then exposed rejection of `--secret-tools` before the intended unmeasured exit 2. These now pass.

Coverage includes generated added/deleted fake Git history (parser fixture test, **not an actual detector run**), bundle secrets, local JWT role decoding, default/production benchmark refusal, symlink/config rejection, mocked network-none/read-only runtime arguments, timeout and rejected-output incomplete semantics. Parser network/socket/DNS spies and fixed argument tests cover no key validation. The authenticated application DB/API/log boundary test checks that an opaque full fake secret never reaches these outputs; fingerprints use first4+last4. This does not assert that unexecuted binaries have been runtime-verified.

The real repository job, URL/browser collection and service adapters feed the existing normalizer. New source-level results are visible in the platform and Markdown exports. Source failures remain incomplete, not successful scans. The old local path remains available when the service is absent.

## Implementation rulings

- Fixture files are sanitized projections of upstream recorded expected formats, not captures from locally executed tools. Version compatibility still needs the Docker run. Provenance and exact versions are in `services/scan-service/tools/fixtures/README.md` and `docs/DECISIONS.md`.
- Local repository access is a separate benchmark-only entry point, refused in production. Only minimal generated Git config is accepted because environment-only config suppression is insufficient for this TruffleHog version.
- TruffleHog must emit a matching completion diagnostic for each pass; error diagnostics make even exit 0 incomplete. Unknown diagnostic formats fail closed, and raw diagnostic values are discarded.
- Same-location secret overlaps render one legacy issue while preserving per-tool redacted evidence. Coalescing cannot reclassify non-secret categories.
- Each benchmark invocation now generates a private temporary input tree. One earlier non-isolated measurement was discarded; only the isolated final run below is authoritative. Seed definitions and scoring remain unchanged.

## Benchmark

Final measurement follows detector implementation/review freeze. No rule was tuned against holdout inputs. The committed `benchmark/task5-final-offline.json` is the **local static reference with offline OSV fixture**, not Gitleaks/TruffleHog recall. Comparison is against `benchmark/task4-final-offline.json`.

| Category | Task 4 recall | Task 5 recall | Precision before → after | FP before → after |
| --- | ---: | ---: | ---: | ---: |
| secret | 5/7 · 71.43% | 5/7 · 71.43% | 100% → 100% | 0 → 0 |
| api | 2/4 · 50% | 2/4 · 50% | 100% → 100% | 0 → 0 |
| code | 4/4 · 100% | 4/4 · 100% | 100% → 100% | 0 → 0 |
| dependency (offline fixture) | 1/1 · 100% | 1/1 · 100% | 100% → 100% | 0 → 0 |
| config | 4/5 · 80% | 4/5 · 80% | 100% → 100% | 0 → 0 |

All category metrics, source snapshots and unordered finding records match Task 4 exactly. Overall: 16/21 expected, 76.19% recall, 100% precision, 0 FP. Dev negative set: **0 FP**. Sealed holdout negative set: **0 FP**, reported separately in the JSON. No recall drop. These small curated sets do not establish general production precision.

### Every expected secret still missed

| Expected id | Category | Location | Reason |
| --- | --- | --- | --- |
| aws-pair | secret | src/aws.ts:1 | Unchanged local matcher does not detect this AWS pair; external tools were not run. |
| deleted-history-secret | secret | src/deleted-secret.ts:1 | Snapshot LocalReader does not inspect deleted Git history; external history tools were not run. Parser-fixture history coverage is not detector recall. |

**The 95% secret-recall goal is not demonstrated.** Actual Gitleaks/TruffleHog recall, precision, missed findings and duration remain **unmeasured**, not zero or clean. No fixture detection was substituted into final tool metrics. When requested tools fail, the benchmark marks secret quality unmeasured and exits 2.

### Targets and duration

| Target | Ran? | Duration |
| --- | --- | ---: |
| seeded local repository | Yes, static + offline dependency fixture | 768 ms |
| clean-marketing | Yes | 35 ms |
| clean-docs | Yes | 54 ms |
| clean-portal | Yes | 50 ms |
| clean-holdout-cache | Yes, final measurement only | 54 ms |
| clean-holdout-frame | Yes, final measurement only | 48 ms |
| clean-holdout-cms | Yes, final measurement only | 51 ms |
| Juice Shop / NodeGoat / DVWA | **NOT RUN**, Docker unavailable | Unmeasured |
| Gitleaks / TruffleHog on seeded history | **NOT RUN**, Docker unavailable | Unmeasured |

Durations are for this authoring environment, not latency promises. Offline OSV results do not measure live OSV availability.

## Commands to run on your server

Follow `docs/SCAN-SERVICE.md` for the existing rootless, dedicated-user deployment, firewall/TLS and protected env files. As that user:

```bash
cd /opt/aegis-audit
export DOCKER_HOST=unix:///run/user/10001/docker.sock
npm ci
npm run scan-service:images
```

For an existing installation, copy **only** `SCAN_IMAGE_GITLEAKS` and `SCAN_IMAGE_TRUFFLEHOG` from `services/scan-service/deploy-local/images.env` into its protected `server.env`. Keep the existing HMAC/Redis/TLS values. Then:

```bash
systemctl --user restart aegis-scan
npm run test:secrets
BENCHMARK_MODE=1 NODE_ENV=test npm run benchmark:secrets -- --target all --osv-offline --final --output benchmark/runs/task5-tools-final.json
npm run test:integration
TEST_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Also restart the application's Worker with the updated code. Do not enable benchmark mode in the production service. The fake seed and its two-commit history are generated locally at benchmark time; never push it to GitHub.

Still needed: the real Task 3 Docker/Redis integration log (limits, network isolation, clone/proxy, cleanup and queue semantics), Task 4's three actual Chromium redirect results, and Task 5's real-tool benchmark JSON. Send sanitized logs and the redacted benchmark JSON, not raw tool output or real credentials. Task 5 implementation is complete with these runtime validations pending. **Stopped here; Task 6 was not started.**
