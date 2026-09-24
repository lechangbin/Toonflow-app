# Project Memory requires committed source evidence

Status: accepted for T13 foundation; legacy migration and full retrieval remain open.

New Agent Memory is Project-owned data, not an instruction channel or a transcript copy. Its first supported kind is a locatable extractive continuity note from an immutable, successfully committed Agent Step Output. The Memory record binds the source Run, Step, Output ID and hash, code-point range, content hash, role and optional Script. Capture must verify the source checkpoint and Output inside one SQLite transaction; streams, failed Attempts and uncommitted Tool results cannot be promoted. Repeated capture of the same range reuses the same record; a conflicting identity fails.

The pre-existing `memories` table remains a compatibility store for old Socket Agents. Its client-shaped isolation key is not proof of Project ownership or Run commit. It is neither bulk-migrated nor silently indexed into ContextBuilder. A later explicit migration may promote individual rows only after independent Project and source evidence can be established; otherwise the legacy UI retains access until its Agent migration.
