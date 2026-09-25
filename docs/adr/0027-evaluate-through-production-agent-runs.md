# Evaluate through production Agent Runs

An Evaluation Run freezes comparison inputs and gathers case evidence, but it does not execute a parallel evaluator-only Agent. Each measured case must link to an actual production Agent Run so lifecycle, Tool permissions, Context, Skill and Trace retain one authority; deterministic fake Model/Vendor adapters may still be injected below that Runtime. This rejects the easier separate scenario implementation because it can pass while the production Run fails, at the cost of slower migration from the existing Golden Eval scenarios.
