# Build immutable ContextBundles before Model intent

Status: accepted for T12 foundation; Agent migration remains open.

Every Model Attempt must select authorized Project sources and produce a versioned ContextBundle before its external-call intent is committed. Mandatory safety, scope, Step intent, permission and minimum Tool/Skill contracts never get truncated: if they do not fit the model-aware budget, the Attempt fails before inference. Optional sources are compacted deterministically by authority and the accepted category allocations; source identity, revision, hash, selection and omission are durable evidence.

The alternative of continuing to concatenate mutable prompt files and Memory in each Agent adapter makes provenance and restart attribution impossible. A Bundle successor records an explicit refresh; it does not rewrite the predecessor. T12 first establishes this ContextBuilder seam and its budget contract, then migrates production Agent flows in their dedicated issues rather than claiming the existing Socket paths already use it.

The Bundle stores exact selected Model messages for repeatable inspection/retry and a separate content-free provenance manifest. Both belong to the Project's Agent evidence lifecycle: normal updates and deletes are prohibited, while authorized Project deletion removes them in its existing transaction. This deliberate retention of input content is limited to Project-scoped Bundle storage, never copied into Trace or exported diagnostics.
