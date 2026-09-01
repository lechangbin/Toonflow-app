# Asset Image Prompt Generation

Read this document before changing Asset prompt polishing, Asset References, batch Asset generation, Image Vendor input, or the Asset configuration UI.

## Current behavior

The current batch-polish route invokes the universal Text Model once per Asset. Its context contains the selected art-style prefix, one type-specific art manual, optional extra text, and the Asset name and description. It does not receive the current Script, sibling Assets, parent Asset content, or persisted reference metadata. The main Asset page can omit a required extra-text field, the frontend fallback type can disagree with the backend prop type, and model output is persisted without a structured contract.

Single-Asset image generation accepts one temporary Base64 reference, but that reference is neither persisted nor described. Batch image generation is text-only. These paths are transitional behavior, not the target contract.

## Target flow

1. Analyze the full current Script once for the selected Asset set and establish a shared World Bible.
2. Run a cross-Asset Contrast Matrix to detect accidental collisions in identity, structure, materials, condition, and value distribution.
3. Produce one structured, provider-independent Asset Brief per selected Asset.
4. Persist each brief with hashes or revisions for its Script, templates, Asset facts, and reference contracts.
5. Compile the final image-generation prompt from the brief, the matching art manual, current Asset facts, and zero or more Asset References.
6. Display only the final compiled prompt in the Asset configuration UI.
7. Submit the compiled prompt and available Asset References through the configured Image Vendor interface.

Test the flow at the shared orchestration boundary. HTTP routes and Vue components are transport and interaction adapters; they do not own prompt composition rules.

## Context priority

Resolve conflicts in this order:

1. Human-authored Asset Reference descriptions and their transfer/exclusion rules.
2. Explicit Script facts and narrative role.
3. Current Asset description and parent-Asset identity for a Derived Asset.
4. Bounded inference from era, identity, profession, social position, and story function.
5. Art-style defaults.

The prompt must make people, scenes, and props narratively distinctive. Generic quality tags cannot replace identity, status, period, occupation, wear, silhouette, material, or environmental evidence.

## Asset Reference contract

Each Asset Reference is human-uploaded and requires a human-written description. Store its declared visual role, required transfers, and explicit exclusions. Reserve an image-analysis service seam and lifecycle metadata for later AI-assisted descriptions, while keeping manual description mandatory in this version.

The configured limit shown by the UI is six references, matching the current Agnes Image 2.1 Flash capability. Agnes Image 2.5 Flash remains a separate capability-validation task; its expected superset does not change the current limit until a real contract test confirms it.

## Template routing

The internal production Skill lives under `data/skills/asset-prompting/` and stays outside the editable runtime prompt catalog:

| Resource | Route |
| --- | --- |
| `SKILL.md` | Stage selection and invariants |
| `prompts/batch_asset_analysis.md` | Full-Script analysis for a selected Asset set |
| `prompts/compile_character_asset.md` | Character and Derived Character prompt compilation |
| `prompts/compile_scene_asset.md` | Scene and Derived Scene prompt compilation |
| `prompts/compile_prop_asset.md` | Prop and Derived Prop prompt compilation |
| `prompts/reference_contract.md` | Reference roles, required transfers, and exclusions |
| `references/asset-brief.schema.json` | Strict Text Model output contract |

The type router maps both legacy and canonical prop identifiers to the prop compiler. Derived Assets also receive their parent Asset identity and facts. Template resolution and output validation belong to the shared orchestration module, not individual routes.

Final prompts use `zh-CN` by default. The orchestration contract carries a language/profile parameter so a future English renderer can be added without changing business inputs; this version does not ship English templates.

## UI boundary

Restore the earlier prompt-management interaction, including click-to-detail behavior. The templates above are internal production templates and do not appear in prompt management in this version. The Asset configuration surface separately owns Asset References and the final editable image prompt.

## Invalidation and observability

A reusable Asset Brief is valid only when its recorded Script, template, Asset, parent-Asset, and reference-contract revisions still match. Regeneration records the active revisions and preserves enough metadata to explain retries. Intermediate brief content stays hidden from ordinary frontend users but remains inspectable through persistence and tests.

## Method sources

The external skill search found no installable workflow covering full-Script comparison, Asset Briefs, reference authority, and final prompt compilation together. Toonflow therefore owns this Skill. Its method combines per-Asset specifications, character continuity, production-design specificity, global art direction, explicit keep/change/do-not-copy contracts, and Seedance-style per-dimension reference authority without installing or depending on third-party Skills.

The existing `art_character`, `art_scene`, and `art_prop` manuals remain type-specific output manuals. Their layout, isolation, media, and render rules are hard constraints. Generic hair, clothing, decoration, weather, material, and condition examples are fallback values and cannot override stronger Script-grounded identity or reference evidence.
