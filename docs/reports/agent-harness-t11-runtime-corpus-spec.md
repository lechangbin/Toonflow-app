# T11 AgentRuntime Case Corpus v1 · implementation contract

Decision: user confirmed a new AgentRuntime 18-case corpus, with T02 Golden 18 cases retained as a separate deterministic baseline. This document specifies the migration; it does not claim the 72-cell production evaluation has run.

## Distinct evidence lines

- T02: `data/eval/agent-harness-golden-v1/manifest.json`, deterministic local Fake Model/Vendor scenarios, historical 18-case hard gates. Preserve its runner, manifest hash, and result identity; never attach its historical outcomes to T11 Agent Runs.
- T11: `data/eval/agent-runtime-corpus-v1/manifest.json` and immutable fixture snapshots. Each case is a production Agent request with one role/scope, concrete content, a Project-data fixture, observable gate definitions, required evidence, and 0/1/2 rubric anchors. The corpus's 18 cases are *new identities*, partitioned 12 development, 3 holdout, 3 incident-regression. Holdout definitions are frozen before candidate tuning and must not be edited in response to results.
- A T11 Evaluation Run freezes the corpus source/hash, fixture hashes, per-case input hash, Project and actor identity, and revisions. Each variant/case/seed points to a distinct terminal Agent Run; 18 × 2 variants × 2 seeds = 72 expected cells, not 72 passed cases. Seed currently identifies a cell and must not be described as model randomness control.

## Corpus interface and validation

Use a versioned strict schema, ordered stable IDs, unique gate IDs, bounded strings, explicit role/scope combinations and declared fixture digests. Define corpus-level rubric revision and per-case title, partition, request content, fixture ID/hash, hard gates, required artifact kinds, expected failure class, and rubric anchors. Reject missing, duplicate, reordered, or cross-corpus case identity and altered fixture/input bytes before starting any Model call. A fixture must materialize an isolated Project with known source and workspace state; `projectId` alone is not a data snapshot. Cases whose asserted behavior cannot be observed through the current Runtime/ToolReceipt/Trace/Output interface are excluded until that observation exists.

Freeze through one small interface that accepts a validated corpus and resolved Project fixture bindings; keep `freezeGoldenEvaluationRun` only for the legacy migration ledger. Consumers resolve the frozen case definitions through one internal reader, avoiding Golden-specific conditionals in every report. A manifest schema bump must fail closed on old records rather than silently reinterpret v2 records. Keep legacy v2 inspection available until stored draft records are deliberately migrated or retired.

## Case design and evidence gates

Design 18 executable Agent-request cases across source grounding, Script workspace use, Production workspace use, foreign-Project refusal, no-source honesty, prompt-injection containment and refusal of unapproved paid effects. These are read-only observations: even Production-role cases may describe an approval path, but the 72-cell corpus must not perform billable generation or write proposals. Interruption/recovery and proposal→approval state-machine behavior belong to separate deterministic Runtime/Tool suites, not to prompt-driven cases; their results must not be counted in the 72 cells. The per-case request, permitted Tool observation, expected Trace/Output evidence, safety check and human judgement boundary are recorded in `docs/reports/agent-harness-t11-case-matrix.md`. Do not substitute 18 generic “check case ID” prompts. Machine-readable observation predicates and independent gate execution remain #104 work; prose hard gates are not executable verdicts.

Coverage means only linked Run evidence. An independent deterministic gate evaluator must derive safety/permission/lineage checks from source Run and artifact bytes; a submitter's `passed: true` is not proof. Human 0/1/2 review requires identified reviewers, blinded baseline/candidate material, rubric calibration, and retained references. Leakage/holdout contamination, redaction violation, or unauthorized escalation are hard-gate failures even if a reviewer likes the output. The report keeps all 36 pairs in the denominator and distinguishes missing, failed, unassessed, gate-failed, and reviewed cells. Cost stays unknown until a trusted provider usage source is attached.

## Delivery order and acceptance

1. Freeze schema, validator, corpus definitions and Project fixture snapshots; add contract tests proving T02/T11 identity separation, canonical ordering, and rejection of altered materialized Project state before external calls.
2. Adapt Evaluation Run create/inspect, coverage, assessment queue/ledger, and paired report to corpus definitions; preserve the T02 path and add focused compatibility tests.
3. Materialize fixtures, execute one safe vertical slice with Fake Model, then run the 72-cell real-provider matrix at global concurrency 1 with explicit revision and budget evidence. Do not conflate a small canary with corpus quality.
4. Independently verify artifacts/hard gates, perform human rubric review, calibrate scores, and publish machine/human paired results plus reproducible commands. Only then consider T11 complete and unblock T19 quality claims/T21 acceptance. Full-suite testing and release remain final acceptance work.

Stage verification is focused unit/integration tests for the touched interface and TypeScript; the full test/build/browser matrix waits for final acceptance as requested. Until step 4, quality benefit is **unverified**.
