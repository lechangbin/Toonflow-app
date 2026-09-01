# Asset Brief Contract

## Pipeline

`full Script → World Bible → Contrast Matrix → Asset Brief[] → Reference Contract[] → type compiler + Model Profile → generationPrompt`

The World Bible keeps Assets in the same production world. The Contrast Matrix gives sibling Assets different visual identities. Neither replaces the per-Asset brief.

## Evidence and precedence

Resolve a controlled visual dimension through this order:

1. Human Asset Reference declaration.
2. Explicit Script evidence.
3. Current Asset description and, for a Derived Asset, parent identity.
4. Bounded inference from era, region, social role, profession, owner, narrative function, and physical history.
5. Art-style default.

The art manual has two kinds of rules. Layout, media, isolation, and render rules remain hard unless the request explicitly changes the output format. Generic hair, clothing, decoration, weather, cleanliness, or material examples are fallbacks and cannot overwrite stronger identity evidence.

Every inferred fact records its reason and confidence. Prefer a concrete causal detail—work wear, rank-appropriate construction, climate adaptation, repair history—over an ornamental adjective. Do not invent named insignia, sacred symbols, exact dynastic regulations, disability, ethnicity, or plot facts without evidence.

## Contrast Matrix

Compare Assets only on dimensions meaningful to their type:

- Characters: silhouette, body posture, face topology, hair topology, wardrobe layers, principal materials, value distribution, signature marks, and negative identity.
- Scenes: spatial structure, action plane, access pattern, landmark, scale, construction, maintenance, use traces, and value distribution.
- Props: geometric silhouette, relative scale, operation, material and craft, wear/repair history, owner marks, and story state.

Similarities are allowed when the Script requires them. Record the shared evidence and create differentiation on other dimensions. A collision is resolved only by changing a brief with narrative justification, not by adding random accessories or colors.

## Continuity

- `immutable`: identity anchors that survive ordinary generations.
- `flexible`: presentation choices that may vary without changing identity.
- `storyChanging`: state controlled by a Script moment, such as damage, clothing condition, time, or weather.

A Derived Asset keeps the parent's immutable identity and changes only declared flexible or story-changing dimensions.

## Reference authority

Each reference has one primary role. A controlled dimension has one winning reference. `mustPreserve` states what transfers; `mustIgnore` prevents incidental transfer. A multi-subject image requires `subjectSelector`. A reference that controls no dimension is excluded from that generation request.

Reference labels and descriptions are stored and rendered verbatim. The compiler may order clauses by priority, but may not rename, translate, or reinterpret them.

## Model Profile

The compiler receives a runtime Model Profile rather than embedding Vendor facts in the brief:

- `referenceMode`: `none`, `single`, or `multi`.
- `maxReferences`: a non-negative integer.
- `languageProfile`: `zh-CN` in this version.

For `none`, compile textual identity anchors only. For `single`, choose the highest-priority reference that controls the most relevant dimensions and report selection deterministically. For `multi`, include each non-empty binding up to the configured limit. The current Agnes Image 2.1 Flash profile uses six; Agnes Image 2.5 Flash is not encoded in this contract.

## Invalidation

Persist hashes or immutable revisions for the Script, selected Asset facts, parent Asset facts, prompt templates, art manuals, and reference contracts. Reuse a brief only when all recorded inputs still match. A failed regeneration preserves the last valid brief and final prompt.

## Type routing

- `role` and character aliases → character compiler.
- `scene` → scene compiler.
- `tool`, `props`, and prop aliases → prop compiler.
- Derived types use the same compiler with parent identity and declared variation.
