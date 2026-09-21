# Persist read-only Agent Runs with orthogonal waiting and attention

Status: accepted

The first Agent Runtime slice is read-only with respect to Project production artifacts and persists its authoritative lifecycle in four records: Agent Run, ordered Agent Step, immutable Agent Run Output, and ordered Agent Trace. `waiting` remains an execution status, while `attentionReason` is an orthogonal operator-attention signal: a waiting Run may or may not require attention, and the UI projects `needs-attention` when that reason is present instead of storing a competing lifecycle status.

Run start is idempotent within Project, role, scope, and `clientRequestId`, with a request fingerprint preventing reuse for different input. Model execution never holds a database transaction open; the Runtime commits intent before the external call and commits Step result, Output, Run state, and Trace together after it returns. If the process stops between those commits, readiness moves the running Run and Step to `waiting`, records `interrupted-model-call` as both waiting and attention reason, appends only a Trace-safe diagnostic, and never automatically replays the possibly billable call.

These four tables are the minimum durable T04 boundary, not the complete causal model planned for later milestones. Outputs store only final user-visible content, while Trace stores versioned allowlisted events and diagnostics; raw provider payloads, hidden reasoning, signed URLs, credentials, and unprojected exceptions are excluded before persistence.
