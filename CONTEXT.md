# Toonflow Production

Toonflow turns source stories into structured scripts, visual assets, storyboards, and generated video through a local AI-assisted production workflow.

## Language

**Project**:
The creative workspace that holds source material, production choices, and generated outputs for one work.
_Avoid_: Workspace, job

**Novel Chapter**:
A numbered slice of imported source material used to preserve narrative order and retrieve adaptation context.
_Avoid_: Document chunk, source block

**Story Event**:
A narrative event extracted from one or more Novel Chapters and used to connect source context to adaptation work.
_Avoid_: Log entry, task event

**Script**:
A structured dramatic adaptation belonging to a Project and serving as the source for Assets and Storyboards.
_Avoid_: Prompt, screenplay file

**Asset**:
A reusable production subject from a Script: a role, scene, prop, or bound voice.
_Avoid_: File, media item

**Derived Asset**:
A visual variation that belongs to a parent Asset while preserving its production identity. It does not own human Asset References; generation inherits the parent through a Parent Asset Anchor and applies only a rule-governed change instruction produced by the Production Agent.
_Avoid_: Duplicate Asset

**Parent Asset Anchor**:
The parent Asset's currently accepted image, supplied automatically when generating a Derived Asset to preserve invariant identity while the change instruction states only the allowed visual differences.
_Avoid_: Asset Reference, Reference Image, user upload

**Derived Change Instruction**:
A Production Agent-authored contract for a Derived Asset that states the parent traits to preserve, the permitted visual changes, and the changes to exclude. It is compiled with the Parent Asset Anchor and the matching derivative visual manual without a second Text Model interpretation.
_Avoid_: Asset Reference description, full image prompt, free-form restyling request

**Asset Reference**:
An authorized, human-uploaded image attached to an Asset with a declared visual role, required transfers, and explicit exclusions.
_Avoid_: Reference Image, Keyframe, Upload

**Asset Brief**:
A persisted, model-independent visual analysis of one Asset, grounded in the current Script and used to compile differentiated image-generation prompts.
_Avoid_: Prompt, Asset description, user-facing introduction

**Storyboard**:
A planned shot that combines narrative intent, visual direction, timing, and related Assets.
_Avoid_: Image, frame

**Keyframe**:
An image assigned an explicit temporal role in a Video Track, such as first frame, intermediate keyframe, or last frame.
_Avoid_: Reference image, upload-order image

**Video Track**:
A production slot that groups Storyboards into one generation instruction and selects a resulting Video.
_Avoid_: Timeline, video file

**Video**:
A generated moving-image candidate associated with a Video Track.
_Avoid_: Video Track, Storyboard

**Project Agent**:
The single user-facing Agent role that coordinates production work and specialist Agent roles within a Project.
_Avoid_: Chat window, Production Agent, Script Agent

**Script Agent**:
The specialist Agent role that turns source context into adaptation plans and Scripts.
_Avoid_: Writer bot

**Production Agent**:
The specialist Agent role that turns Scripts into Assets, Storyboards, production plans, and generation instructions.
_Avoid_: Video Agent

**Agent Memory**:
Project-isolated retained conversation knowledge used to maintain continuity across Agent sessions.
_Avoid_: Chat history

**Skill**:
An editable production instruction that guides an Agent role or a specialized execution step.
_Avoid_: Prompt template

**Vendor**:
A programmable integration that exposes one or more AI Models to Toonflow.
_Avoid_: Model, provider configuration

**Model**:
A text, image, video, or audio generation capability exposed by a Vendor.
_Avoid_: Vendor

**Video Capability**:
A provider-independent video operation exposed by a Model, including its accepted inputs, reference semantics, and output choices.
_Avoid_: Mode, model mode

**Prompt Profile**:
Capability-specific guidance for turning production intent into a Model-ready generation prompt.
_Avoid_: Prompt template, Vendor prompt

**Prompt Revision**:
An immutable Prompt Brief, structured Draft, rendering strategy, and rendered video prompt associated with one Video Track.
_Avoid_: Editable prompt field, Model prompt

**Production Action**:
A user- or Agent-initiated unit of production work that reads or changes Project artifacts and may include, but is not limited to, Model generation.
_Avoid_: Agent task, Generation Task, route operation

**Artifact Revision**:
An immutable version of a Project artifact produced by a Production Action and retained as a draft, accepted result, or rejected result.
_Avoid_: Backup, history row, overwritten artifact

**Generation Task**:
A tracked attempt to use a Model for a Project output, including an immutable command snapshot, provider checkpoint, progress, and failure state.
_Avoid_: Video Track, Agent task
