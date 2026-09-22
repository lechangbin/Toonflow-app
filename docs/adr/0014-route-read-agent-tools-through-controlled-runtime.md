# Route read Agent Tools through one controlled runtime

Status: proposed

Existing Script Agent read Tools mix model-facing schemas, database queries, and Socket thinking callbacks. The first Harness read Tools instead use immutable versioned ToolDefinitions and one Controlled Tool Runtime that validates, authorizes against the Run Project, deduplicates stable operation identities, invokes a domain adapter with a frozen least-privilege context, validates bounded output, and commits a ToolReceipt with a causal Trace. The model never receives a database handle, HTTP response helper, or Socket callback.

Read Tools do not require approval and can safely re-read domain data, but a duplicate operation must not create a second receipt or silently change its bound Tool revision/input. ToolReceipt stores only safe bounded output and structural evidence; Trace stores metadata and safe diagnostics, not copied novel text or Provider payloads. A failed authorization or output contract must be recorded without executing an unauthorized adapter or exporting unsafe content. This is a local SQLite control seam, not a migration of the legacy Script Agent session, which belongs to the later Agent migration stage.
