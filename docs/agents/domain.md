# Domain Docs

## Before exploring

Read the root `CONTEXT.md` and every relevant record under `docs/adr/`. Missing files are not blockers; domain-modeling creates them when a term or durable decision is resolved.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

Use canonical terms from `CONTEXT.md` in issues, refactor proposals, tests, and code. When a needed term is missing, resolve it through domain-modeling before adding a synonym. Surface any conflict with an existing ADR explicitly.
