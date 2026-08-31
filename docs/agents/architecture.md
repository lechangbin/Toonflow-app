# Architecture Review

The 2026-08-27 review examined recent-change hotspots through the deep-module vocabulary: module, interface, implementation, depth, seam, adapter, leverage, and locality. This revision records the state after the database readiness and configured Vendor delivery (#13–#24) landed on `develop`.

## Implemented foundation: Video production

Issue #2 established provider-independent Video Capabilities, strict Prompt Profiles, a validated Vendor runtime boundary, and shared prompt/video production modules. Read `docs/agents/video-generation.md` for the active contract and migration boundaries.

`src/video/production.ts` is the orchestration module. HTTP single/batch routes supply validated intent; Vendor adapters receive one validated command and own only provider translation, upload, polling, checkpointing, and result retrieval. Project defaults seed a Track, the Track stores the actual selection, and a Generation Task freezes the execution snapshot.

## Implemented: Supplier execution runtime

ADR-0005 is accepted and delivered by `src/vendor/`: one configured Vendor module exposing typed Text invocation and streaming, Image, Video, and TTS generation, Vendor inspection and listing, startup validation, and typed configuration commands. Every operation shares the single internal configured loader (`src/vendor/loader.ts`); the source-level runtime (`src/lib/vendorRuntime.ts`) stays internal to its configured/source-validation seams, enforced by the static contract guards. Business code composes `getDefaultConfiguredVendor()` or injects the typed dependencies instead of loading programmable Vendor code.

## Implemented: Database lifecycle

ADR-0004 is accepted and delivered by `src/database/`: one fixed readiness order — open local resources, ensure the current schema, apply known upgrades, reconcile required defaults, recover interrupted work, and validate the database and required runtime invariants — with ordinary work through shared leases and typed exclusive maintenance that replays the whole lifecycle. Every former `u.db(...)` call site now borrows a lease through `getDatabaseRuntime().work(...)`; the transitional bridge is deleted and `tests/staticContractGuards.test.ts` rejects new bypasses. SQLite remains the only storage adapter, so storage replacement is still not a justified seam.

## Worth exploring: Agent session runtime

Script Agent and Production Agent duplicate authentication, abort handling, thinking state, stream consumption, memory writes, sub-Agent lifecycle, and output cleanup. They are two real adapters for a shared session seam, but migration risk is higher because behavior is largely untested.

## Enabler: shrink the global `u` locator — partially done

`src/utils.ts` no longer exposes `db`, `Ai`, `vendor`, or `vm`; the remaining fields (oss, getConfig, uuid, error, cleanNovel, getPath, task, getPrompts, getArtPrompt, replaceUrl, writeVersion) are narrow utility capabilities. Keep shrinking it as deeper modules establish stable interfaces; do not add new global locators.

## Evidence

- 0 `u.db(...)` / `u.Ai` / `u.vendor` call sites in `src/`, enforced by `tests/staticContractGuards.test.ts`.
- Exactly one database readiness implementation (`src/database/`), one built-in Vendor registry (`src/lib/vendorRegistry.ts`), and one configured Vendor loader (`src/vendor/loader.ts`).
- The automated suite covers the Agnes Vendor adapter, database readiness and maintenance, configured Vendor operations, and the cross-module release-candidate integration (`tests/releaseCandidateIntegration.test.ts`).

## Decision status

ADR-0001 and ADR-0002 record the accepted Video decisions; ADR-0003 the container runtime-data lifecycle; ADR-0004 the explicit database readiness lifecycle; ADR-0005 configured Vendor execution. Agent session runtime remains an exploration candidate; record new hard-to-reverse decisions under `docs/adr/` before implementation.
