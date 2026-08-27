# Architecture Review

The 2026-08-27 review examined recent-change hotspots through the deep-module vocabulary: module, interface, implementation, depth, seam, adapter, leverage, and locality.

## Priority 1: Supplier execution runtime — Strong

`data/vendor/*.ts`, `src/utils/ai.ts`, `src/utils/vendor.ts`, `src/utils/vm.ts`, Vendor settings routes, and `src/lib/fixDB.ts` share the knowledge required to load and execute a configured Model. Multiple Vendor adapters prove the seam is real. Deepen this module first so compilation, configuration, sandbox execution, result normalization, and task behavior gain one test surface.

## Priority 2: Video Track generation — Strong

The single/batch prompt and single/batch video routes duplicate reference lookup, prompt selection, task creation, state transitions, generation, and persistence. Deepen around one Video Track; single and batch routes become adapters over the same interface.

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

These are exploration candidates, not accepted designs. Do not introduce interfaces or move production code until a candidate has passed the grilling and design flow. Record accepted hard-to-reverse decisions under `docs/adr/`.
