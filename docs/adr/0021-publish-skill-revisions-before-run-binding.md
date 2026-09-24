# Publish Skill revisions before Agent Run binding

Status: accepted for T14 foundation; routing and legacy Agent migration remain open.

A Skill Definition is stable identity, a draft SkillRevision is editable authoring state, and a published SkillRevision is an immutable content plus versioned manifest snapshot. A SkillBinding selects one published revision for future Runs. A Run's own revision binding freezes the exact revision ID and hashes at resolution time; later activation or rollback only changes the active binding and never rewrites that Run.

The first slice persists these four distinct concepts and validates manifest identity, roles, intents, dependency/resource declarations, requested Tools and capabilities before publication. The manifest only requests capabilities; it cannot authorize a Tool. Dependency resolution, resource loading, permission intersection, routing, administrative projection, and legacy Skill import are subsequent T14/T15 work. Existing Socket Agents keep their legacy Markdown path behavior until their migration; the new Runtime must not silently treat a current file as a published revision.
