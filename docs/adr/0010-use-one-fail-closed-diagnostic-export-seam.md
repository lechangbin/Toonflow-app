# Use one fail-closed diagnostic export seam

Status: accepted

Toonflow uses one versioned Trace-safe Diagnostic contract for Trace, ToolReceipt, evaluation, and UI-safe projections. A Diagnostic exposes one primary failure class (`Extraction`, `Decision`, `Tool`, `Context`, `Vendor`, or `Artifact`) plus orthogonal stage, stable kind, severity, outcome certainty, expectedness, and retry disposition; it never treats free-form provider text as evidence.

The shared `src/diagnostics/` module owns recursive inspection and projection. Credentials, authorization material, Base64 or binary payloads, URLs, raw Provider payloads, hidden reasoning, unknown fields, cycles, excessive depth, and unsafe exception chains reject the whole export with structural violation locations. Callers may not silently delete unsafe fields and continue, because that would make incomplete evidence appear trustworthy. Existing domain diagnostics adapt into this seam; Agent Run and Trace persistence remain deferred to their own milestones.

This concentrates redaction changes in one deep module and keeps projections consistent. The trade-off is deliberate fail-closed behavior: a new diagnostic field must be explicitly added to the shared allowlist and covered by negative fixtures before it can be persisted or exported.
