# ADR 0023: Production Agent image proposals stop at the Owner approval boundary

Status: accepted for the T17 proposal-only slice (Issue #73); full production generation acceptance is deferred to T21.

## Context

T17 introduces a durable Production Agent Run. The legacy Production Socket flow can request images, but a model-issued request is not Owner authorization to incur cost. T09 already has a single-Asset billable image approval and Vendor ledger. Reusing that ledger requires a trustworthy link from a Production Run's Tool operation to the child approval, without giving the model the approval or dispatch authority.

## Decision

- Expose `propose_asset_image_generation` only to opt-in Production Harness Runs with a frozen compatible Skill that requests the Tool and `propose:billable-image`, plus a current Owner-granted Project capability. This grant is distinct from read access and from the approval command.
- The model Tool may create one pending T09 billable-image approval Run for an Asset target. It has no Vendor dispatch path and returns only pending approval identifiers or a denial. The existing Owner approval, preflight, request ledger, and ambiguous-dispatch recovery remain the only route to an external effect.
- Before creating the child, atomically validate the running parent Run, its lease and actor, frozen Skill binding, Tool contract, current grant, and recorded permission decision. Freeze parent Run ID, Tool operation ID, Skill ID, and proposal contract hash in the child. On inspection, verify the parent and hashed allow decision again; the approval operation must match the recorded parent operation. The database prevents rewriting approval bindings.
- Repeated Tool operation IDs use a deterministic request key and the existing ledger's request fingerprint. A changed target is a conflict, not a second billable request. Grant revocation denies subsequent proposals; it does not silently erase an already pending Owner decision.

## Consequences and limits

This decision separates three authorities: model suggestion, Owner approval, and Vendor submission. It does not migrate batch image generation, storyboard writes, video generation, or the legacy Socket path. The fake-model and fake-quote unit tests demonstrate the local boundary and zero Vendor requests before approval; they do not prove real Provider behavior, cross-process recovery, browser UX, or full T17/T21 acceptance.
