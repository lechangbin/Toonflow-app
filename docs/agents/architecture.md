# Architecture Review

The 2026-08-27 review examined recent-change hotspots through the deep-module vocabulary: module, interface, implementation, depth, seam, adapter, leverage, and locality. This revision records the state after the database readiness and configured Vendor delivery (#13–#24) landed on `develop`.

## Implemented foundation: Video production

Issue #2 established provider-independent Video Capabilities, strict Prompt Profiles, a validated Vendor runtime boundary, and shared prompt/video production modules. Read `docs/agents/video-generation.md` for the active contract and migration boundaries.

`src/video/production.ts` is the orchestration module. HTTP single/batch routes supply validated intent; Vendor adapters receive one validated command and own only provider translation, upload, polling, checkpointing, and result retrieval. Project defaults seed a Track, the Track stores the actual selection, and a Generation Task freezes the execution snapshot.

## Implemented: Supplier execution runtime

ADR-0005 is accepted and delivered by `src/vendor/`: one configured Vendor module exposing typed Text invocation and streaming, Image, Video, and TTS generation, Vendor inspection and listing, startup validation, and typed configuration commands. Every operation shares the single internal configured loader (`src/vendor/loader.ts`); the source-level runtime (`src/lib/vendorRuntime.ts`) stays internal to its configured/source-validation seams, enforced by the static contract guards. Business code composes `getDefaultConfiguredVendor()` or injects the typed dependencies instead of loading programmable Vendor code.

## Implemented: Database lifecycle

ADR-0004 is accepted and delivered by `src/database/`: one fixed readiness order — open local resources, ensure the current schema, apply known upgrades, reconcile required defaults, recover interrupted work, and validate the database and required runtime invariants — with ordinary work through shared leases and typed exclusive maintenance that replays the whole lifecycle. Every former `u.db(...)` call site now borrows a lease through `getDatabaseRuntime().work(...)`; the transitional bridge is deleted and `tests/staticContractGuards.test.ts` rejects new bypasses. SQLite remains the only storage adapter, so storage replacement is still not a justified seam.

## Implemented: Asset image prompt orchestration

ADR-0006 separates persisted, Script-grounded Asset Briefs from final image-generation prompts. `src/assets/assetPromptOrchestration.ts` analyzes a selected Asset set, validates structured briefs, compiles type-specific prompts, and applies Asset Reference contracts. `src/assets/assetImageGeneration.ts` resolves persisted prompts and references for the configured Image Vendor.

ADR-0007 is implemented by `src/assets/derivedAssetPrompt.ts` and the thin Production Agent adapter at `src/routes/production/assets/batchGenerateAssetsImage.ts`: base Assets own human Asset References, while Derived Assets use a system-resolved Parent Asset Anchor plus a structured Derived Change Instruction and deterministic prompt compilation.

## Implemented: Base Asset two-stage extraction

Issue #41 replaces the grouped, route-owned Script Asset extraction with the deep orchestration module `src/script/baseAssetExtraction.ts`. One run receives all selected Scripts as a single full context and performs exactly two Text Model calls: one Base Asset extraction pass and one completeness-review pass. Both calls reuse one Model target resolved once at run start through the `ConfiguredVendor.openTextCall(target)` handle, which binds the resolved Vendor/Model and its persisted tuning. The HTTP route `src/routes/script/extractAssets.ts` is a thin adapter; it no longer owns Text Model orchestration, `groupSize`, Script chunking, or per-group database writes.

Provider wire-format normalization and strict runtime validation stay in `src/script/assetExtractionContract.ts`. Model tool output is captured raw and parsed after the call returns, so invalid tool output always fails the run instead of being swallowed as a tool error. Deterministic backend code then validates evidence (known Script IDs, non-empty bounded excerpts with locatable scene/section markers), merges identities (type + canonical name + aliases + script evidence; same-name-only merging and fuzzy/embedding matching are forbidden; ambiguous identities stay separate and log `identityAmbiguous` backend-only), folds derived-state names such as 大泽乡·雨夜 back into their Base Asset, and sorts the staged result.

Persistence adds `o_assetIdentity`: one current, schema-versioned structured identity record per Base Asset, separate from `o_assets.describe`, which remains the deterministic compiled compatibility summary (refreshed on re-extraction only for extraction-managed Assets, i.e. those that already carry an identity record). `persistBaseAssetExtraction` writes Assets, identity records, and Script links in one transaction inside a single database lease, so a mid-write failure rolls back without partial writes; every model or validation failure happens before any write. The staged result consumed by persist is the integration seam for #44's confirmed atomic replacement.

### Prompt asset loading route

The two stage prompts are version-controlled Skill templates under `data/skills/asset-extraction/`, loaded at runtime by `createDefaultBaseAssetSkillFileLoader()` (resolves under the data root, returns null when missing):

| Stage | Template | Input contract | Output contract |
| --- | --- | --- | --- |
| Base extraction | `prompts/base_asset_extraction.md` | all selected Scripts joined with `===== 【剧本ID: id】name =====` separators | `resultTool` with `{ assets: BaseAssetCandidate[] }` |
| Completeness review | `prompts/base_asset_completeness_review.md` | candidate digest + the same full Script context | `resultTool` with `{ additions, factAdditions, typeCorrections, aliasProposals }` |

The review may add omitted Assets, add stable evidence-grounded facts, correct types, and propose evidence-backed aliases; the contract has no removal operation and the backend rejects derived-state output. The templates are not part of frontend prompt management (`o_prompt`); the legacy `scriptAssetExtraction` / `scriptAssetExtractionBatch` prompt rows are deleted on upgrade. Field-level contracts live in `assetExtractionContract.ts`; changing them requires updating the templates, the contract module, and `tests/baseAssetExtraction.test.ts` together (see `data/skills/asset-extraction/SKILL.md`).

## Worth exploring: Agent session runtime

Script Agent and Production Agent duplicate authentication, abort handling, thinking state, stream consumption, memory writes, sub-Agent lifecycle, and output cleanup. They are two real adapters for a shared session seam, but migration risk is higher because behavior is largely untested.

## Enabler: shrink the global `u` locator — partially done

`src/utils.ts` no longer exposes `db`, `Ai`, `vendor`, or `vm`; the remaining fields (oss, getConfig, uuid, error, cleanNovel, getPath, task, getPrompts, getArtPrompt, replaceUrl, writeVersion) are narrow utility capabilities. Keep shrinking it as deeper modules establish stable interfaces; do not add new global locators.

## Evidence

- 0 `u.db(...)` / `u.Ai` / `u.vendor` call sites in `src/`, enforced by `tests/staticContractGuards.test.ts`.
- Exactly one database readiness implementation (`src/database/`), one built-in Vendor registry (`src/lib/vendorRegistry.ts`), and one configured Vendor loader (`src/vendor/loader.ts`).
- The automated suite covers the Agnes Vendor adapter, database readiness and maintenance, configured Vendor operations, and the cross-module release-candidate integration (`tests/releaseCandidateIntegration.test.ts`).

## Decision status

ADR-0001 and ADR-0002 record the accepted Video decisions; ADR-0003 the container runtime-data lifecycle; ADR-0004 the explicit database readiness lifecycle; ADR-0005 configured Vendor execution; ADR-0006 the two-stage Asset image prompt boundary; ADR-0007 the Derived Asset parent-anchor boundary. Agent session runtime remains an exploration candidate; record new hard-to-reverse decisions under `docs/adr/` before implementation.
