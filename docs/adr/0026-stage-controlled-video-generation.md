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
