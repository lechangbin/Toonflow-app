---
name: asset-prompting
description: Analyze a Toonflow Script and selected Assets into differentiated Asset Briefs, then compile Chinese image-generation prompts for character, scene, prop, and Derived Assets. Use for Asset prompt polishing or reference-aware Asset image generation, not Storyboards or video prompts.
---

# Asset Prompting

Build traceable visual identity before writing image-model prose.

## Choose the stage

- For one selected Asset set, load [prompts/batch_asset_analysis.md](prompts/batch_asset_analysis.md) and validate the response with [references/asset-brief.schema.json](references/asset-brief.schema.json).
- For one validated Asset Brief, load exactly one type compiler: [character](prompts/compile_character_asset.md), [scene](prompts/compile_scene_asset.md), or [prop](prompts/compile_prop_asset.md).
- When the Asset has references, also load [prompts/reference_contract.md](prompts/reference_contract.md). With zero references, omit this prompt and all reference wording.
- Read [references/contract.md](references/contract.md) when changing the schema, precedence, invalidation, type routing, or Model Profile behavior.
- After changing the contract or prompts, run `node scripts/validate-fixtures.mjs` to verify the cross-Asset regression fixtures.

## Invariants

1. Analyze the complete current Script and the whole selected Asset set before compiling individual prompts.
2. Run the cross-Asset Contrast Matrix before accepting any brief. Shared world style does not justify accidental shared identity.
3. Treat explicit human reference contracts as highest authority, followed by Script facts, current and parent Asset facts, bounded inference, then style defaults.
4. Preserve evidence and distinguish explicit facts from inference. Unknown facts remain unknown when inference would change identity materially.
5. Keep Asset Briefs provider-independent. Model limits and reference modes belong to the compiler's Model Profile.
6. Emit final prompts in `zh-CN`. Carry the language profile through the interface; this version has no English renderer.
7. Preserve reference labels and human descriptions verbatim. Assign one winning reference per controlled dimension and no authority by upload order.
8. Keep Asset Briefs internal. The frontend receives only the final editable generation prompt and reference controls.

The stage is complete only when every requested Asset ID appears exactly once, the schema validates, all reported collisions are resolved, and the selected compiler emits only one usable prompt.
