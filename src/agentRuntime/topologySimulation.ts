import { z } from "zod";

import { topologyPlanHash, validateTopologyHandoff,
  validateTopologyPlan, type TopologyHandoff,
  type TopologyPermissionCatalog } from "./topologyPlan";

const artifactRefSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
  kind: z.enum(["plan", "candidate", "verification", "final"]),
  ownerRole: z.enum(["planner", "worker", "specialist", "verifier"]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
type ArtifactRef = z.infer<typeof artifactRefSchema>;
const roleOutputSchema = z.strictObject({ artifacts: z.array(artifactRefSchema).min(1).max(10) });

export interface TopologyRoleContext {
  role: string; caseId: string; seed: number;
  skillIds: readonly string[];
  input: TopologyHandoff | null;
  invokeTool(name: string, payload: unknown): Promise<unknown>;
}

/** Experiment-only seam: real persistence, lease and Vendor policy remain outside this driver. */
export async function simulateTopology(input: {
  plan: unknown; permissions: TopologyPermissionCatalog;
  caseId: string; seed: number; contextBundleHash: string;
  now(): number;
  handlers: Record<string, (context: TopologyRoleContext) => Promise<unknown>>;
  toolPort(name: string, payload: unknown): Promise<unknown>;
}): Promise<{ planHash: string; toolCalls: number;
  finalArtifact: ArtifactRef; handoffs: TopologyHandoff[] }> {
  const plan = validateTopologyPlan(input.plan, input.permissions);
  const planHash = topologyPlanHash(plan);
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(input.caseId)
    || !Number.isSafeInteger(input.seed) || input.seed < 0
    || !/^[a-f0-9]{64}$/u.test(input.contextBundleHash)) {
    throw new TypeError("Topology experiment identity is invalid");
  }
  const startedAt = input.now();
  let toolCalls = 0;
  let preceding: TopologyHandoff | null = null;
  let lastArtifacts: ArtifactRef[] = [];
  const handoffs: TopologyHandoff[] = [];
  for (const [index, role] of plan.roles.entries()) {
    if (input.now() - startedAt > plan.stop.maxWallMs) {
      throw new TypeError("Topology experiment wall-time budget exceeded");
    }
    const handler = input.handlers[role.id];
    if (!handler) throw new TypeError("Topology role handler is missing");
    const raw = await handler({ role: role.id, caseId: input.caseId,
      seed: input.seed, skillIds: [...role.skillIds], input: preceding,
      invokeTool: async (name, payload) => {
        if (!role.toolNames.includes(name)
          || toolCalls >= plan.stop.maxToolCalls
          || input.now() - startedAt > plan.stop.maxWallMs) {
          throw new TypeError("Topology role Tool call is unauthorized or over budget");
        }
        toolCalls++;
        return input.toolPort(name, payload);
      } });
    const output = roleOutputSchema.parse(raw);
    if (output.artifacts.some((artifact) => artifact.ownerRole !== role.id
      || !role.owns.includes(artifact.kind))) {
      throw new TypeError("Topology role emitted an Artifact outside ownership");
    }
    lastArtifacts = output.artifacts;
    const edge = plan.handoffs[index];
    if (!edge) break;
    const artifacts = output.artifacts.filter((artifact) =>
      edge.allowedArtifactKinds.includes(artifact.kind));
    const handoff = validateTopologyHandoff(plan, {
      schemaVersion: "toonflow.topology-handoff.v1", planHash,
      caseId: input.caseId, fromRole: role.id, toRole: edge.to,
      contextBundleHash: input.contextBundleHash,
      reasonCode: index === 0 ? "plan-ready" : "candidate-ready",
      artifacts,
    });
    handoffs.push(handoff);
    preceding = handoff;
  }
  if (input.now() - startedAt > plan.stop.maxWallMs
    || handoffs.length !== plan.stop.maxHandoffs) {
    throw new TypeError("Topology experiment did not satisfy stop conditions");
  }
  const finalArtifact = lastArtifacts.find((artifact) => artifact.kind === "final");
  if (!finalArtifact || plan.aggregate === "verifier-gated"
    && !lastArtifacts.some((artifact) => artifact.kind === "verification")) {
    throw new TypeError("Topology final Artifact lacks required aggregation evidence");
  }
  return { planHash, toolCalls, finalArtifact, handoffs };
}
