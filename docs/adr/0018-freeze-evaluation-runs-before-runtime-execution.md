# Freeze Evaluation Runs before case execution

Status: accepted for the T11 foundation; full case execution and paired acceptance remain open.

T02's checked-in Golden Eval result is an immutable historical baseline from before Agent Runtime existed, not a candidate run to replay through a new implementation. T11 freezes the case manifest and explicit Runtime, Tool, Context, Skill, Model, Vendor, rubric and schema revisions into a durable Evaluation Run before executing any case. Each future candidate case result must link an actual production Agent Run; a pending case has no result and cannot be counted as passed. This rejects a parallel evaluator-only execution path while preserving the historical baseline as comparison input.

The alternative of importing T02 cases as if they were Agent Runs would invent provenance. The alternative of accepting direct domain-scenario results for new candidates would preserve the very split T11 is meant to remove. The current read-only Agent Runtime cannot yet execute all Script-to-Asset-to-Image scenarios, so schema/freeze delivery must not be reported as 18-case migration or a paired quality win. Later execution adapters must expand production Runtime capabilities without silently substituting T02's direct-domain adapter.

Attaching a case observation is separate from completing its evaluation: it requires a production Agent Run with the case-specific request identity and an intact causal Trace, and freezes the observed Run version and last sequence. It does not mark hard gates passed or create artifact evidence. A later scorer must verify the semantics of each required artifact rather than treating an arbitrary Trace ID as proof of a manifest artifact.

Paired comparison treats the identical manifest, Evaluation result schema and rubric as required measurement contracts. Runtime, Tool, Context, Skill, Model and Vendor revisions are treatment dimensions: differences are explicitly reported, not silently called compatible because a suite name matches. This compatibility check is only a prerequisite; it never asserts case execution, evidence completeness or improved quality.
