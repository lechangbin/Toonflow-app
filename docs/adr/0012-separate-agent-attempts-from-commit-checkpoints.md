# Separate Agent Attempts from commit checkpoints

Status: accepted

An Agent Attempt records one physical try of a logical Agent Step, while an Agent Checkpoint is an immutable, hash-linked proof that an explicit Run commit boundary completed. The Runtime commits a `model-call-intent` checkpoint immediately before a provider call: interruption before that boundary is known to have no provider effect and may create a causally linked successor Attempt under restart policy, while interruption after it and before a terminal commit has unknown effect and must wait for attention without automatic replay. A successful terminal checkpoint references the committed Output by identity and hash so restart can reuse it instead of calling the provider again; streaming tokens, partial responses, raw provider payloads, and in-memory results never qualify as checkpoints.

Attention remains orthogonal to Run lifecycle. Corrupt or unsupported checkpoint evidence prevents scheduling and adds a safe attention signal without rewriting an already terminal Run into a non-terminal status.
