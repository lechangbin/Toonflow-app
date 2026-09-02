# Generate Derived Assets from parent anchors and explicit change instructions

Derived Assets do not accept human Asset References. The Production Agent records a structured Derived Change Instruction, and image generation deterministically compiles it with the parent Asset's currently accepted image (the Parent Asset Anchor) and the matching derivative visual manual. This preserves parent identity without a second Text Model interpretation or a competing human-reference contract.

## Consequences

- A Derived Asset cannot generate without a valid parent relationship, Parent Asset Anchor, and change instruction.
- Base Assets retain the zero-to-six human Asset Reference workflow; those references are rejected for Derived Assets.
- Existing non-empty legacy descriptions may be converted deterministically, but the runtime must not ask a Text Model to guess missing change intent.
- Parent image, change instruction, visual-manual, and style revisions invalidate the compiled prompt and trigger deterministic recompilation.
