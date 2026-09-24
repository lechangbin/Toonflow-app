# ADR 0026: Stage controlled Video generation without reusing the manual dispatch

Status: preflight contract only, T17 Issue #73 incomplete.

## Context

The existing `startVideoGenerationBatch` validates Video Capability and Prompt Revision, creates Production Action and Generation Task records, then asynchronously calls the Vendor. Its error path marks provider failures as failed even when submission might have happened. Reusing it directly as a model Tool would give the Agent a billable side effect without a separate Owner decision or an unknown-result no-replay boundary.

## Decision

- Keep manual single/batch Video routes as compatibility paths. HTTP workbench callers cannot claim `requestedBy: "project-agent"`; trusted internal modules may use that provenance only after their own authority checks.
- The first controlled Video candidate is one existing Video Track, text-to-video only, with no external image/file reference. The Project-owned Script and Track, active Prompt Revision, current Track selection, and absence of an existing Video must agree. Its exact payload and relevant target state, including the Prompt Revision's structured brief/draft and rendered text, are hashed without writing a Production Action or contacting a Vendor.
- A later Owner approval must re-run this preflight in its commit transaction and compare target hashes. It must then record a durable submission intent and distinguish known failure from unknown Provider outcome before any Agent-facing Vendor Tool becomes available. Approval, dispatch, recovery, cancellation and late-result reconciliation are not implemented by this ADR's first slice.
- Image-to-video, keyframes, uploaded media and batches need separate Project-scoped media ownership and deduplication contracts; they are not silently accepted by this first slice.

## Consequences and evidence

`src/controlledTools/videoGenerationProposalContract.ts` is a no-effect preflight seam. `tests/videoGenerationProposalContract.test.ts` covers Project isolation, selected/already-generated Video rejection, unsupported media, exact Track selection, Prompt Revision drift and invalid persisted JSON. No model Tool or HTTP approval is exposed yet. Vendor capability inspection and true Provider semantics still belong to later controlled execution work and T21 final acceptance.

The second preparatory slice extracts `prepareVideoGenerationCommand` from the manual Video orchestration. Manual generation and future controlled dispatch now share one no-write command validation path for Track scope, configured Model/Capability, Prompt Profile and image inputs. `prepareControlledVideoProposal` combines that path with the frozen Track/Prompt state and checks the state again after asynchronous Vendor inspection; it returns hashes and a bounded preview, not media bytes or dispatch authority. Approval must later rerun preparation and compare both target and command hashes. Focused fake-Vendor tests prove no Production Action, Generation Task or Vendor submission occurs during preparation and detect target drift during inspection.

An Owner-configured `o_agentVideoQuotePolicy` stores a versioned local approval estimate keyed by the exact Project, Vendor, Model, text-to-video capability, output selection and audio selection. The server rejects absent, invalid or mismatched policy rows; an Owner-only compare-and-swap update prevents silent overwrites. Authenticated `/api/agentRuns/videoQuote/get` and `/set` routes expose only this configuration, never a dispatch action; Project deletion purges its policy rows in the authorized transaction. This is an upper-bound estimate for a future Owner decision, **not** a Vendor quote, billing receipt, dispatch permit or assurance that a request will cost that amount. No Web setting, approval or Vendor call is connected yet. Approval must bind the quote revision and exact selection and recheck both before committing dispatch intent. Capability availability alone cannot invent a price.

`videoApprovalScope` now binds the prepared payload, target-state hash, command hash, exact quote target, revision and amount into one candidate scope hash. Its `recheck` rejects a changed quote revision, Track/Prompt target or prepared command. It is still an in-memory candidate: without a durable child Run and Owner decision, the hash does not authorize dispatch.
