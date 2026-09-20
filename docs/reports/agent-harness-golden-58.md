# Agent Harness T02 — 18-case Golden Eval baseline

## Delivery identity

- Issue: `lechangbin/Toonflow-app#58`
- Frozen Harness baseline: `6c4f4d5fadb1463b7ae7bafe422d46b34407dd42`
- Evaluated implementation commit: `943a08893f1255f68837ab2f4b038a5d1d6d151e`
- Suite: `agent-harness-golden-v1`
- Runner: `golden-eval-runner@1.0.0`
- Manifest SHA-256: `f591cf24090b041b6b573fa14a7d63b08283dbbb30dabbfc0bef148072b57940`
- Raw-result SHA-256: `76c817f9ee20b465198e297ac18deaae1e5e0fb354178f4ae7515adcba0845e1`
- Execution tier: deterministic local fakes; no paid or real Vendor call

This report describes functionality and evidence only. It does not provide resume wording or claim live-Provider quality.

## What changed

T02 adds a versioned, data-first evaluation corpus and a deterministic Runner around the frozen pre-Harness production baseline:

1. `data/eval/agent-harness-golden-v1/manifest.json` defines exactly eighteen stable cases: twelve development, three holdout, and three incident-regression cases.
2. Every case declares fixture sources, Ground Truth, hard gates, required artifacts, an expected failure class, and an anchored 0/1/2 quality rubric.
3. `src/eval/goldenEval.ts` validates the manifest and fixture paths, executes cases serially, checks required evidence, rejects sensitive exported artifacts, preserves every gate failure, and reports partition denominators and failure taxonomy.
4. `src/eval/goldenEvalScenarios.ts` calls existing production domain seams with a fresh temporary SQLite database per case and deterministic Fake Model/Vendor adapters.
5. `scripts/runGoldenEval.ts` exposes a machine-readable CLI. `yarn eval:golden:write` refreshes the checked-in immutable raw baseline; the test suite rejects drift.
6. `tests/goldenEval.test.ts` protects the 12/3/3 split, stable IDs, manifest contracts, deterministic reruns, checked-in raw evidence, and fail-fast partition validation.

## Execution boundary

The T02 Runner does not copy production decisions into an evaluation-only implementation. Its scenario registry calls the existing public seams for Base Asset extraction and merge, Asset Prompt compilation, Derived Asset resolution, Asset Reference admission, image lifecycle recovery and polling, cancellation, failure classification/redaction, and atomic re-extraction.

The two image incident replays execute through the production `generateAssetImage` seam. The Fake Vendor triggers the real stage callbacks; timeout classification, single-call policy, cancellation observation, media-write suppression, and terminal conditional writes are therefore covered as one production flow rather than reimplemented as evaluation-only SQL.

Each case receives:

- an isolated file-backed temporary SQLite database initialized with the application schema;
- a scripted Fake Text Model that can only return the fixture's Tool payload;
- a scripted Fake Image Vendor that records calls and returns or throws the selected local result;
- a fixed clock wherever a production seam accepts one;
- no configured default Vendor, network credential, production database, or user media.

This is intentionally the frozen baseline adapter. T03 first establishes the shared trace-safe diagnostic taxonomy and redaction gates; T04 introduces the first durable read-only Agent Run. The persistent Evaluation Run and final “Eval Runner only through Agent Runtime” seam remain assigned to T11 (#67). The stable case IDs, Ground Truth, and fixtures are designed to survive that adapter replacement.

## Corpus coverage

| Partition | Cases | Covered behavior |
| --- | ---: | --- |
| Development | 12 | two-stage extraction, deterministic ordering, Derived-state folding, invalid evidence, reference priority, reference-free prompts, character differentiation, multi-dimension Derived prompts, invalid change contracts, six-reference limit, restart recovery, diagnostic redaction |
| Holdout | 3 | unselected Script evidence, human-reference rejection for Derived Assets, explicit null polling records |
| Incident regression | 3 | ambiguous timeout without replay, late success after cancellation, transaction rollback during confirmed re-extraction |

The checked-in raw result lists every case, every hard gate, every artifact, expected failure classification, and the quality-review state. Expected domain failures count as a passing case only when the stable rejection and zero-side-effect Ground Truth both pass.

## Scoring contract and result

Hard gates and human quality are deliberately separate:

| Report | Result | Meaning |
| --- | --- | --- |
| Hard-gate cases | 18 / 18 passed | All deterministic safety, state, scope, consistency, and side-effect assertions passed |
| Development | 12 / 12 passed | Fixture-facing cases passed |
| Holdout | 3 / 3 passed | Non-development cases passed |
| Incident regression | 3 / 3 passed | Recorded incident mechanisms did not regress |
| Human quality | 0 reviewed / 18 pending | Rubrics are frozen, but no human evaluation was fabricated |
| Composite score | none | Safety cannot be hidden by an average quality score |

The empty `failuresByTaxonomy` map means there were no evaluation failures in this run. It does not mean the cases contain no expected domain failures: expected failures remain visible per case under `expectedFailureClass` and artifacts.

Every case also receives an `artifact-export-contract` gate before export. The Runner first requires top-level artifact names to match the case's Manifest allowlist, then recursively rejects credential-shaped keys, raw Provider payload or hidden-reasoning keys, signed URLs, binary values, and long Base64-like payloads. On rejection it persists only structural placeholder locations, never untrusted key names or values, marks the case failed, and classifies the evaluation failure as `Artifact/evaluation/redactionFailed`. Runner-owned execution errors bypass scenario artifact validation and remain a single `runnerError` classification. T03 generalizes this boundary for Trace, Tool receipts, evaluation, and UI-safe projections.

## Reproduction

```text
yarn eval:golden
yarn eval:golden:write
node --import tsx --test tests/goldenEval.test.ts
yarn test
yarn lint
yarn build
git diff --check
```

`yarn eval:golden` prints only JSON on standard output. `yarn eval:golden:write` is the explicit mutation command for the versioned raw result. A changed manifest changes its hash and run identity; a changed result without an intentional refresh fails the checked-in-baseline test.

Manifest identity normalizes CRLF and LF before hashing. The same committed manifest therefore has one identity on Windows and Linux; the focused contract test exercises both encodings.

## Verification evidence

- Focused Golden Eval contract tests: 10 / 10 passed.
- Final repository acceptance suite: 416 / 416 passed (run once after all T02 code changes).
- TypeScript check: passed.
- Production build: passed; the generated App bundle is byte-equivalent to the frozen baseline because the Eval Runner is an offline entry point.
- Golden run: 18 executed, 18 hard-gate case passes, zero evaluation failures.
- Repeated Golden runs: structurally identical, including hashes and case artifacts.
- Paid Provider calls: zero.
- Production database and media mutation: zero.
- Raw machine-readable evidence: `docs/reports/data/agent-harness-golden-v1-results.json`.

The build was performed from a worktree whose dependencies are junctioned to the primary checkout. The generated bundle's source-path comments were canonicalized back to `node_modules/`; its Git blob hash remained `073c2143fd794646d56e0331aec42b097ec382ee`, proving that T02 does not change the shipped runtime bundle.

## Compatibility and rollback

- No database schema or migration is added.
- No route, Socket session, frontend bundle, configured Vendor loader, or production generation path is changed.
- Existing domain modules remain authoritative; evaluation depends on their injected public contracts.
- Removing the two package scripts plus `src/eval`, `scripts/runGoldenEval.ts`, the versioned manifest/results, tests, and this documentation fully rolls back T02.
- Temporary SQLite directories are destroyed after each case, including failed cases.

## Known limits

1. Fixture success does not establish live Model or Vendor output quality, latency, cost, or availability.
2. The 0/1/2 quality rubrics are pending human review; this milestone contains no quality score.
3. T02 runs against the frozen baseline domain adapter because Agent Runtime does not exist until T04. Persisted Evaluation Runs, candidate-versus-baseline comparison, and execution only through Agent Runtime belong to T11 (#67).
4. The corpus covers the chosen Script-to-Asset-to-Prompt-to-Image golden path, not the full Video production pipeline.
5. There is no browser or deployed Electron acceptance in this ticket.

## Next design handoff

T03 should make diagnostic taxonomy and redaction reusable by Trace, Tool receipts, evaluation output, and UI-safe projections without changing these case identities. T04 then introduces the first durable read-only Agent Run. T11 (#67) replaces the T02 baseline scenario adapter with execution through Agent Runtime and persists manifests, revisions, comparisons, and reviewer provenance.
