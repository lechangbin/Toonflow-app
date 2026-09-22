# Fence Agent Run writes and separate cancellation intent

Status: accepted

An Agent Run Lease binds executable writes to a worker owner, process epoch, expiry, and monotonic fence. Claim and takeover are short SQLite transactions; every later worker write checks that exact ownership tuple and the current Run state, while the Model call remains outside the transaction. Lease expiry alone does not prove a Provider request did not happen: restart still follows the last verified Agent Checkpoint, and post-intent effects are never replayed automatically.

Cancellation is an idempotent, version-checked Agent command that first persists intent. A Run may become terminal `cancelled` only before an external effect can be unsettled; after `model-call-intent`, cancellation stops future scheduling but an in-flight call must settle or require reconciliation. Socket disconnect and reconnect do not grant, revoke, or infer Run authority: HTTP snapshots and commands remain the durable control interface.
