# ADR 0024: Production Agent derived Asset writes require a separate Owner decision

Status: accepted for the T17 proposal-only slice (Issue #73); full production migration remains open.

## Context

T08 already has a durable derived Asset approval Run that checks Project ownership, parent Asset, Script, expected revision, equivalent visual state, and target-state hash. The legacy Production Socket Agent can write derived Asset records directly. An opt-in Production Harness model must not inherit that mutation authority from a read grant or an image generation grant.

## Decision

- Expose `propose_derived_asset_write` as a model-facing, no-effect Tool only in the Production Harness. Its input is the frozen T08 derived Asset write contract; it returns a pending child approval identifier, never an Asset ID or success claim.
- Require a published bound Skill requesting this Tool and `propose:derived-asset`, plus a current, versioned Owner Project grant. This capability is distinct from `write:derived-asset`, production read, and billable-image proposal capabilities.
- In one database transaction, check the parent Run is running and uncancelled, its actor and lease, the bound Skill revision, proposal Tool contract, current grant, and hashed permission decision. A deterministic key binds the parent Run and operation ID; changed payloads conflict. Persist parent Run, operation, Skill, and proposal contract hash in the T08 child Run. Inspect verifies that provenance before presenting the approval.
- Reuse T08's Owner decision and target-state/equivalence checks for the actual local write. Revoking the grant prevents new proposals but does not retroactively rewrite an existing Owner decision.

## Consequences and limits

The model cannot commit a derived Asset; only the authenticated Owner can approve the child Run. The T17 unit test proves local proposal, denial, idempotency, and a single Owner-approved commit. It does not migrate other Production Socket writes, batch generation, video, browser UX, or cross-process recovery. The existing approval UI is separate from the new Harness effects projection, which still needs to expose this child source to the opt-in panel.
