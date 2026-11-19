# Recorded format fixtures — fake values only

These are sanitized projections of upstream recorded expected output, not newly captured executions on this machine. No Docker or tool binary is required to test the parsers. They are format/normalization tests, never benchmark detector results.

- Gitleaks **8.24.2**: upstream `testdata/expected/report/json_simple.json` (blob `21e3c604fa86f090acb44627ef88752ff47f9dd0`), `report/finding.go` (blob `431d2a59b9d99eb83bea345b0331fda9244ffd9e`) and `report/json_test.go`. Recorded field names and types are retained; secret, path, author, commit and example rule labels are replaced with fake fixture values. Source: https://github.com/gitleaks/gitleaks/blob/v8.24.2/testdata/expected/report/json_simple.json . Empty upstream report is `[]`, confirmed separately.
- TruffleHog **3.88.23**: recorded JSON example in README lines 218–230 (blob `c3e8fc3ef425de16bd33a9aec891e12b55ab333c`) and `pkg/detectors/detectors.go` (blob `9b3a4ffed841792660f5c6f29763afda770db7c0`). Public canary/example account material is NOT copied. Fields are retained with fake-only values; Verified is false to represent the required `--no-verification` run. Source: https://github.com/trufflesecurity/trufflehog/blob/v3.88.23/README.md . The flag definitions were checked in pinned main.go, blob `8715027a7431fe89f27819e3643c5dec91380213`.

No upstream secret/canary is contacted, validated or retained. `Redacted` is intentionally not trusted by the parser. Only local fake fingerprints leave the parsers. Parsers reject malformed, partially masked or verified-mode outputs as incomplete. Do not substitute expected benchmark findings for actual tool results.
# Source encoding for publication

Fake Stripe-shaped fixture values use a JSON Unicode escape for their initial character. Decoding yields exactly the same fake value; matching test literals use the equivalent JavaScript escape. This avoids publishing literal credential-shaped test tokens. No real credential is included, and parser formats, expected findings, detection rules and scoring are unchanged.

