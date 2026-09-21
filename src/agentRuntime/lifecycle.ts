export const AGENT_RUN_STATUSES = ["queued", "running", "waiting", "succeeded", "failed", "cancelled"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_STEP_STATUSES = [
  "pending",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
] as const;
export type AgentRunStepStatus = (typeof AGENT_RUN_STEP_STATUSES)[number];

const RUN_TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  queued: ["running", "waiting", "failed", "cancelled"],
  running: ["waiting", "succeeded", "failed", "cancelled"],
  waiting: ["queued", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

const STEP_TRANSITIONS: Readonly<Record<AgentRunStepStatus, readonly AgentRunStepStatus[]>> = {
  pending: ["running", "waiting", "failed", "cancelled", "skipped"],
  running: ["waiting", "succeeded", "failed", "cancelled"],
  waiting: ["pending", "cancelled", "skipped"],
  succeeded: [],
  failed: [],
  cancelled: [],
  skipped: [],
};

export class AgentRunStateConflictError extends Error {
  constructor(entity: "Run" | "Step", from: string, to: string) {
    super(`非法 ${entity} 状态转换: ${from} -> ${to}`);
    this.name = "AgentRunStateConflictError";
  }
}

export function parseAgentRunStatus(value: unknown): AgentRunStatus {
  if (typeof value === "string" && (AGENT_RUN_STATUSES as readonly string[]).includes(value)) {
    return value as AgentRunStatus;
  }
  throw new AgentRunStateConflictError("Run", String(value), "inspect");
}

export function parseAgentRunStepStatus(value: unknown): AgentRunStepStatus {
  if (typeof value === "string" && (AGENT_RUN_STEP_STATUSES as readonly string[]).includes(value)) {
    return value as AgentRunStepStatus;
  }
  throw new AgentRunStateConflictError("Step", String(value), "inspect");
}

export function assertAgentRunTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!RUN_TRANSITIONS[from].includes(to)) throw new AgentRunStateConflictError("Run", from, to);
}

export function assertAgentRunStepTransition(from: AgentRunStepStatus, to: AgentRunStepStatus): void {
  if (!STEP_TRANSITIONS[from].includes(to)) throw new AgentRunStateConflictError("Step", from, to);
}
