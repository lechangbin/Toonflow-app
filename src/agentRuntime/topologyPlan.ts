import { createHash } from "node:crypto";

import { z } from "zod";

export const TOPOLOGY_PLAN_VERSION = "toonflow.topology-plan.v1" as const;
export const TOPOLOGY_HANDOFF_VERSION = "toonflow.topology-handoff.v1" as const;

const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const roleId = z.enum(["planner", "worker", "specialist", "verifier"]);
const artifactKind = z.enum(["plan", "candidate", "verification", "final"]);

const roleSchema = z.strictObject({ id: roleId,
  toolNames: z.array(identifier), skillIds: z.array(identifier),
  owns: z.array(artifactKind) });
const edgeSchema = z.strictObject({ from: roleId, to: roleId,
  allowedArtifactKinds: z.array(artifactKind).min(1),
  maxPayloadBytes: z.number().int().positive().max(65536) });

export const topologyPlanSchema = z.strictObject({
  schemaVersion: z.literal(TOPOLOGY_PLAN_VERSION),
  topology: z.enum(["T0", "T1", "T2"]),
  roles: z.array(roleSchema).min(1).max(3),
  handoffs: z.array(edgeSchema).max(2),
  stop: z.strictObject({ maxHandoffs: z.number().int().nonnegative().max(2),
    maxToolCalls: z.number().int().positive(),
    maxWallMs: z.number().int().positive() }),
  aggregate: z.enum(["worker-output", "verifier-gated"]),
  revision: identifier,
});
export type TopologyPlan = z.infer<typeof topologyPlanSchema>;

export interface TopologyPermissionCatalog {
  [role: string]: { toolNames: readonly string[]; skillIds: readonly string[] };
}

const shape = {
  T0: { roles: ["worker"], edges: [], aggregate: "worker-output" },
  T1: { roles: ["planner", "worker"], edges: ["planner:worker"],
    aggregate: "worker-output" },
  T2: { roles: ["planner", "specialist", "verifier"],
    edges: ["planner:specialist", "specialist:verifier"],
    aggregate: "verifier-gated" },
} as const;

export function validateTopologyPlan(input: unknown,
  permissions: TopologyPermissionCatalog): TopologyPlan {
  const plan = topologyPlanSchema.parse(input);
  const expected = shape[plan.topology];
  const roles = plan.roles.map((entry) => entry.id);
  const edges = plan.handoffs.map((entry) => `${entry.from}:${entry.to}`);
  if (JSON.stringify(roles) !== JSON.stringify(expected.roles)
    || JSON.stringify(edges) !== JSON.stringify(expected.edges)
    || plan.aggregate !== expected.aggregate
    || plan.stop.maxHandoffs !== plan.handoffs.length) {
    throw new TypeError("Topology roles, handoffs or stop contract do not match variant");
  }
  const owners = new Map<string, string>();
  for (const role of plan.roles) {
    const allowed = permissions[role.id];
    if (!allowed || new Set(role.toolNames).size !== role.toolNames.length
      || new Set(role.skillIds).size !== role.skillIds.length
      || role.toolNames.some((name) => !allowed.toolNames.includes(name))
      || role.skillIds.some((id) => !allowed.skillIds.includes(id))) {
      throw new TypeError("Topology role exceeds its trusted Tool or Skill permissions");
    }
    for (const kind of role.owns) {
      if (owners.has(kind)) throw new TypeError("Topology Artifact ownership is ambiguous");
      owners.set(kind, role.id);
    }
  }
  if (owners.get("final") !== (plan.topology === "T2" ? "verifier" : "worker")) {
    throw new TypeError("Topology final Artifact has no expected owner");
  }
  for (const edge of plan.handoffs) {
    if (edge.allowedArtifactKinds.some((kind) => !owners.has(kind)
      || owners.get(kind) !== edge.from)) {
      throw new TypeError("Topology handoff references an Artifact not owned by sender");
    }
  }
  return plan;
}

export function topologyPlanHash(plan: TopologyPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export const topologyHandoffSchema = z.strictObject({
  schemaVersion: z.literal(TOPOLOGY_HANDOFF_VERSION),
  planHash: digest, caseId: identifier,
  fromRole: roleId, toRole: roleId,
  contextBundleHash: digest,
  reasonCode: z.enum(["plan-ready", "candidate-ready"]),
  artifacts: z.array(z.strictObject({ id: identifier, kind: artifactKind,
    ownerRole: roleId, contentHash: digest })).min(1).max(10),
});
export type TopologyHandoff = z.infer<typeof topologyHandoffSchema>;

/** Handoffs carry references and hashes, never raw prompts or artifact bodies. */
export function validateTopologyHandoff(plan: TopologyPlan,
  input: unknown): TopologyHandoff {
  const handoff = topologyHandoffSchema.parse(input);
  const edge = plan.handoffs.find((entry) => entry.from === handoff.fromRole
    && entry.to === handoff.toRole);
  const owner = plan.roles.find((role) => role.id === handoff.fromRole);
  if (!edge || !owner || handoff.planHash !== topologyPlanHash(plan)
    || handoff.artifacts.some((item) => item.ownerRole !== handoff.fromRole
      || !owner.owns.includes(item.kind)
      || !edge.allowedArtifactKinds.includes(item.kind))
    || Buffer.byteLength(JSON.stringify(handoff), "utf8") > edge.maxPayloadBytes) {
    throw new TypeError("Topology handoff violates bound plan, owner or size limit");
  }
  return handoff;
}

const topologyEvidenceSchema = z.strictObject({
  topology: z.enum(["T0", "T1", "T2"]),
  caseManifestHash: digest, seedSetHash: digest,
  budgetHash: digest, resultsHash: digest,
  expectedRuns: z.number().int().positive(),
  executedRuns: z.number().int().nonnegative(),
  repeatedSeeds: z.number().int().min(2),
  qualityPassed: z.boolean(), latencyPassed: z.boolean(),
  costPassed: z.boolean(), tokenPassed: z.boolean(),
  retriesPassed: z.boolean(),
  hardGateFailures: z.number().int().nonnegative(),
});
export type TopologyEvidence = z.infer<typeof topologyEvidenceSchema>;

/** Metrics-only ranking; source Run and review provenance are not verified here. */
export function chooseSimplestTopology(inputs: readonly unknown[]): {
  state: "incomplete" | "none-passed" | "unverified";
  topology: null;
  thresholdCandidate: "T0" | "T1" | "T2" | null;
} {
  if (inputs.length !== 3) return { state: "incomplete", topology: null,
    thresholdCandidate: null };
  const evidence = inputs.map((input) => topologyEvidenceSchema.parse(input));
  if (evidence.some((item, index) => item.topology !== ["T0", "T1", "T2"][index])
    || evidence.some((item) => item.caseManifestHash !== evidence[0].caseManifestHash
      || item.seedSetHash !== evidence[0].seedSetHash
      || item.budgetHash !== evidence[0].budgetHash
      || item.expectedRuns !== evidence[0].expectedRuns
      || item.repeatedSeeds !== evidence[0].repeatedSeeds
      || item.executedRuns !== item.expectedRuns)) {
    return { state: "incomplete", topology: null, thresholdCandidate: null };
  }
  const first = evidence.find((item) => item.qualityPassed && item.latencyPassed
    && item.costPassed && item.tokenPassed && item.retriesPassed
    && item.hardGateFailures === 0);
  return first ? { state: "unverified", topology: null,
    thresholdCandidate: first.topology }
    : { state: "none-passed", topology: null, thresholdCandidate: null };
}
