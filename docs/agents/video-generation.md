# Video Generation Contract

Read this document before changing Video Models, Prompt Profiles, Video Track persistence, production routes, Vendor adapters, or Artifact selection.

## Change sequence

1. Update the provider-independent schemas in `src/video/capability.ts` or `src/video/productionContract.ts`. The change is complete when invalid legacy and ambiguous inputs fail before persistence or provider calls.
2. Update the matching Prompt Profile under `data/promptProfiles/video/<family>/`. The file path and frontmatter `id` must match, and every Video Capability must resolve its declared profile.
3. Update the shared orchestration in `src/video/promptGeneration.ts` or `src/video/production.ts`. Single and batch HTTP routes remain thin adapters over these modules.
4. Update only the affected retained Vendor adapters. When release inclusion or default-enable policy changes, change `src/lib/vendorRegistry.ts` once; fresh defaults, repair, startup, build validation, and manifest generation follow. Regenerate `src/lib/vendor.json`, and add contract plus adapter regression coverage.
5. Update fresh schema, upgrade repair, generated database types, and this document together. Completion requires test, typecheck, Vendor manifest, build, and diff checks to pass.

## Capability registry

Built-in Vendor identity, release inclusion, and default-enable policy are owned by the built-in Vendor registry in `src/lib/vendorRegistry.ts`; no second retained or removed Vendor list exists. The table below records the Video Models, Video Capabilities, and audio policy that the retained Vendor adapter programs declare. Additional user-created Vendor files remain supported and pass the same strict runtime validation.

| Vendor | Models in this iteration | Capabilities | Audio policy |
| --- | --- | --- | --- |
| `agnes` | Agnes Video V2.0 | text, source image, ordered keyframes | native, always enabled |
| `volcengine` | Seedance 2.0 / Fast | text, one source image | native, optional |
| `volcengineSd2` | Seedance 2.0 / Fast | text, one source image | native, optional |
| `minimax` | Hailuo 2.3 / Fast, Hailuo-02 | text, one source image; Hailuo-02 also strict first/last | none |

DeepSeek is also retained as a text-only Vendor. Its official `deepseek-v4-flash` and
`deepseek-v4-pro` models can be bound to Agent and Prompt Revision text requests; it does not
participate in the Video Capability registry.

The canonical capability IDs are `text-to-video`, `image-to-video`, `first-last-frame`, and `keyframe-to-video`. Video Models use `capabilities`; the former Video `mode` field is rejected. Image Model `mode` is a separate contract.

Agnes keyframes use semantic roles. Two images mean `first-frame` to `last-frame`; three mean `first-frame` to `intermediate-keyframe` to `last-frame`. Array position never assigns meaning. Seedance nine-image reference generation is a deferred capability, not an extension of `image-to-video`.

## Prompt pipeline

Prompt Profiles are immutable, versioned Markdown files with strict frontmatter. A Model capability selects the profile by `promptProfileId`; model-name branching is outside the prompt pipeline.

`PromptBrief -> one structured LLM Draft -> validation -> deterministic rendering -> Prompt Revision`

`standard` uses the profile section contract. `standard-with-guidance` also supplies the profile's distilled craft guidance to the one LLM call. Manual edits create a `custom` Prompt Revision and preserve the rendered text without reverse parsing. Video generation accepts only `promptRevisionId`, then revalidates and deterministically re-renders structured revisions before execution.

The Agnes profiles distill transferable Seedance prompt craft. Their attribution is recorded in frontmatter; runtime code has no dependency on the local Seedance skill installation.

## Persistence ownership

| Record | Owns |
| --- | --- |
| Project | default Vendor, Model, Capability, and output preset for new Tracks |
| Video Track | actual Vendor/Model/Capability selection, explicit input references, output selection, active Prompt Revision, selected video |
| Production Action | one user or future Project Agent intent, including a batch |
| Prompt Revision | immutable brief, structured draft, strategy, profile ID, and rendered prompt |
| Generation Task | one immutable validated command snapshot plus provider checkpoint and outcome |
| Artifact Revision | Track-scoped monotonically increasing result version and `draft`/`generated`/`accepted`/`rejected` state |

Provider checkpoints may change while a task is running; `commandSnapshot` does not. Image payloads are represented by their semantic source and SHA-256 digest rather than copied Base64.

## Runtime boundary

`loadVendorRuntime` is the executable boundary. For Video, it validates the Model and command before invoking `videoRequest(command, model)`. Adapters translate that command to provider fields, upload media, submit or resume tasks, checkpoint provider IDs, poll, and return the result. They do not read Project defaults, Tracks, Prompt Profiles, or the database.

Build validates packaged Vendor sources and Prompt Profiles. Startup additionally validates configured input values and custom Models. Vendor add, source update, and custom Model routes validate before writing. Any invalid built-in or custom Video configuration stops that operation; partial registration and fallback are outside the contract.

## HTTP and future Agent adapters

The current prompt routes call `generateVideoPromptRevision`; current video routes call `startVideoGenerationBatch`. Prompt generation and manual Prompt Revision edits carry the complete Track selection (`vendorId`, `modelId`, `capabilityId`, `inputs`, `output`, and `audio`) and persist it atomically with the active `promptRevisionId`. Single and batch routes share the strict selection schemas in `src/video/productionContract.ts`. Future Project Agent tools must call these shared modules with `requestedBy: "project-agent"`; they should not duplicate orchestration or treat socket messages as state.

The future infinite-canvas Agent window may compose asset extraction, prompt generation, and video generation, but the backend records remain the source of truth. That UI and Agent-tool expansion is outside Issue #2.

## Frontend migration boundary

This workspace contains generated `data/web` assets, not editable Toonflow-web source. Migrate the separate frontend against these backend contracts before presenting the new flow:

- Replace Video `mode` and model-name routing with Vendor -> Model -> Capability -> output preset selection.
- Send explicit input objects with `role`, `source`, and `sourceId` or `filePath`; render Agnes first/intermediate/last slots by role.
- Generate or edit a Prompt Revision first, then pass only `promptRevisionId` to video generation.
- Treat Agnes audio as enabled and locked; expose optional audio only where the capability declares it.
- Read Track actual selections and Artifact Revision state from backend responses; Project values are creation defaults.
- Keep Seedance multi-reference UI disabled until a separate capability is implemented.

Do not patch `data/web` by hand. Rebuild it from Toonflow-web after that repository adopts the contract.

The currently integrated frontend bundle was built from `lechangbin/Toonflow-web` commit
`93557eaa5844ff1307c140d225c4405291e11b2d`.
