# Architecture Review

The 2026-08-27 review examined recent-change hotspots through the deep-module vocabulary: module, interface, implementation, depth, seam, adapter, leverage, and locality.

## Implemented foundation: Video production

Issue #2 established provider-independent Video Capabilities, strict Prompt Profiles, a validated Vendor runtime boundary, and shared prompt/video production modules. Read `docs/agents/video-generation.md` for the active contract and migration boundaries.

`src/video/production.ts` is the orchestration module. HTTP single/batch routes supply validated intent; Vendor adapters receive one validated command and own only provider translation, upload, polling, checkpointing, and result retrieval. Project defaults seed a Track, the Track stores the actual selection, and a Generation Task freezes the execution snapshot.

## Next priority: Supplier execution runtime — Strong

Text, image, and TTS paths still use the broader programmable Vendor surface. Deepen that runtime only when a concrete change crosses those model types; preserve the strict Video seam already in place.

## Priority 3: Database lifecycle — Strong

Database import currently triggers filesystem work, connection creation, schema initialization, repair, default-data mutation, and development type generation. Deepen around explicit database readiness. SQLite is currently the only storage adapter, so storage replacement is not yet a justified seam.

## Priority 4: Agent session runtime — Worth exploring

Script Agent and Production Agent duplicate authentication, abort handling, thinking state, stream consumption, memory writes, sub-Agent lifecycle, and output cleanup. They are two real adapters for a shared session seam, but migration risk is higher because behavior is largely untested.

## Enabler: shrink the global `u` locator — Worth exploring

`src/utils.ts` is a shallow module imported by most source files and participates in circular dependencies. Shrink it incrementally as the deeper modules above establish stable interfaces; do not replace it with a larger global locator.

## Evidence

- 169 route files and 130 files with direct `u.db(...)` calls.
- 175 source files import the global `u` locator.
- Only one test file currently exists, with 13 Agnes adapter cases.
- Recent changes repeatedly touch Vendor code, video workbench routes, Agent modules, database schema types, and repair logic.

## Decision status

Video decisions are accepted in ADR-0001 and ADR-0002. Database lifecycle and Agent session runtime remain exploration candidates; record new hard-to-reverse decisions under `docs/adr/` before implementation.
