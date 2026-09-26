# ADR 0024: Production Agent derived Asset writes require a separate Owner decision

Status: accepted for the T17 proposal-only slice (Issue #73); full production migration remains open.

## Context

T08 already has a durable derived Asset approval Run that checks Project ownership, parent Asset, Script, expected revision, equivalent visual state, and target-state hash. The legacy Production Socket Agent can write derived Asset records directly. An opt-in Production Harness model must not inherit that mutation authority from a read grant or an image generation grant.

## Decision

- Expose `propose_derived_asset_write` as a model-facing, no-effect Tool only in the Production Harness. Its input is the frozen T08 derived Asset write contract; it returns a pending child approval identifier, never an Asset ID or success claim.
- Require a published bound Skill requesting this Tool and `propose:derived-asset`, plus a current, versioned Owner Project grant. This capability is distinct from `write:derived-asset`, production read, and billable-image proposal capabilities.
- In one database transaction, check the parent Run is running and uncancelled, its actor and lease, the bound Skill revision, proposal Tool contract, current grant, and hashed permission decision. A deterministic key binds the parent Run and operation ID; changed payloads conflict. Persist parent Run, operation, Skill, and proposal contract hash in the T08 child Run. Inspect verifies that provenance before presenting the approval.
- Reuse T08's Owner decision and target-state/equivalence checks for the actual local write. Revoking the grant prevents new proposals but does not retroactively rewrite an existing Owner decision.
- Return the exact schema-validated payload on Owner-only inspect/list only after its hash, preview, Tool contract and Receipt binding have been verified. Corrupt evidence omits the payload and is inspect-only; an Owner should not approve from a summary alone.

## Consequences and limits

The model cannot commit a derived Asset; only the authenticated Owner can approve the child Run. The T17 unit test proves local proposal, denial, idempotency, a single Owner-approved commit, and verified exact-payload projection. The opt-in Web panel now shows that payload through the parent effects projection, but browser UX has not been accepted. This does not migrate other Production Socket writes, batch generation, video, or cross-process recovery.
