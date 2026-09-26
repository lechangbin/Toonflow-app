# ADR 0025: Supervise single-Storyboard writes on an existing Video Track

Status: single-Storyboard supervised slice implemented for the T17 staged migration (Issue #73); the full Production Agent golden path remains incomplete.

## Context

The legacy Production Agent sends `addStoryboard` through a browser Socket callback. The Web handler invokes a batch HTTP route that may insert a Storyboard before a later Track operation fails. An acknowledgement cannot prove atomic, recoverable completion, and a model request cannot be treated as Owner authority to change Project storyboards.

## Decision

- The first controlled write slice creates exactly one Storyboard on an existing Project-owned Video Track and Script. Track creation, multi-Storyboard grouping, image generation, and Video generation are separate effects; do not fold them into this Tool.
- For this slice, the Track must be empty and its configured duration must equal the proposed Storyboard duration. This avoids silently mixing the controlled write with a legacy grouped Track or changing the Track's playback contract.
- The proposal interface accepts only a bounded typed payload: Script ID, Track ID, visual description, optional prompt, duration, image-intent flag, and a unique bounded set of related Asset IDs. Project, Script, Track, and Asset relations are resolved on the server. An Asset must belong to the Project and the Script directly or through the Script–Asset association. A Track that already selected/generated a Video is not eligible.
- Freeze a hash of the exact payload and a hash of the relevant target state (Track selection and Asset linkage). A future pending ToolApproval must require a separate Owner decision and recheck the target in the commit transaction. Its effect must atomically insert the Storyboard, associations, ToolReceipt, Checkpoint and Trace, with an idempotent operation identity. No browser callback may own completion.
- Keep the existing manual/batch routes as explicit compatibility paths until the controlled path is complete. The short-term App/Web callback fix only avoids known false success and optimistic frontend state; it does not supply a durable receipt.

## Consequences and staged evidence

`src/controlledTools/storyboardWriteContract.ts` validates ownership and freezes hashes. `storyboardWriteApproval.ts` creates a durable pending child Run and requires an Owner decision. The model only sees `propose_storyboard_write`, which requires a published Skill request, `propose:storyboard` Project grant, and a live parent Run lease. The approval transaction rechecks the exact target and atomically inserts the Storyboard and Asset associations with Receipt, Output, Checkpoint and Trace. Startup and Owner inspection expire stale pending approvals without replaying a write. An Owner-only HTTP route and the Web trial panel expose exact-payload review and versioned decisions; the parent effects projection reconstructs status from persisted permission and child approval evidence. Targeted App/Web tests cover scope, target drift, Owner isolation, revocation, forged lease, rejection, expiry, idempotency, and rollback on association failure. Browser acceptance, multi-Storyboard grouping, Track creation, image/video generation, and real process-restart evidence are not yet done. T17 and T21 remain open.
