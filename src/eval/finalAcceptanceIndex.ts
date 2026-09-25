import { z } from "zod";

export const FINAL_ACCEPTANCE_INDEX_VERSION = "toonflow.final-acceptance-index.v1" as const;
export const REQUIRED_ACCEPTANCE_IDS = [
  "functional", "compatibility", "recovery", "security",
  "evaluation", "build", "browser",
] as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.string().trim().min(1).max(128);
const evidenceRef = z.string().regex(/^(?:docs|data|tests|artifacts)\/[A-Za-z0-9._\/-]+$/u)
  .refine((value) => !value.split("/").includes(".."));
const revisionManifestSchema = z.strictObject({
  app: revision, web: revision, schema: revision, bundle: digest,
  runtime: revision, tool: revision, context: revision,
  memory: revision, skill: revision, topology: revision,
  model: revision, vendor: revision, cases: revision,
});

export const finalAcceptanceIndexSchema = z.strictObject({
  schemaVersion: z.literal(FINAL_ACCEPTANCE_INDEX_VERSION),
  issue: z.literal("lechangbin/Toonflow-app#77"),
  revisionManifest: revisionManifestSchema.nullable(),
  items: z.array(z.strictObject({
    id: z.enum(REQUIRED_ACCEPTANCE_IDS),
    state: z.enum(["pending", "passed", "failed"]),
    evidenceRefs: z.array(evidenceRef),
    testCommand: z.string().min(1).max(1000).nullable(),
    resultHash: digest.nullable(),
    sourceRevision: revision.nullable(),
    note: z.string().min(1).max(1000),
  })).length(REQUIRED_ACCEPTANCE_IDS.length),
  paidProviderCanary: z.strictObject({
    state: z.enum(["not-run", "passed", "failed"]),
    reason: z.string().min(1).max(1000),
  }),
});
export type FinalAcceptanceIndex = z.infer<typeof finalAcceptanceIndexSchema>;

export function validateFinalAcceptanceIndex(input: unknown): FinalAcceptanceIndex {
  const index = finalAcceptanceIndexSchema.parse(input);
  if (index.items.some((item, position) => item.id !== REQUIRED_ACCEPTANCE_IDS[position])) {
    throw new TypeError("Final acceptance criteria must be complete and in canonical order");
  }
  for (const item of index.items) {
    if (item.state === "passed" && (item.evidenceRefs.length === 0
      || !item.testCommand || !item.resultHash || !item.sourceRevision)) {
      throw new TypeError(`Passed acceptance item ${item.id} has no reproducible evidence`);
    }
    if (item.state !== "passed" && item.resultHash !== null) {
      throw new TypeError(`Unaccepted item ${item.id} cannot claim a result hash`);
    }
  }
  return index;
}

/** Readiness never treats a missing paid canary as proof of Provider behavior. */
export function assessFinalAcceptance(input: unknown): {
  ready: boolean; pending: string[]; failed: string[];
  paidProviderCanaryGap: boolean;
} {
  const index = validateFinalAcceptanceIndex(input);
  const pending = index.items.filter((item) => item.state === "pending")
    .map((item) => item.id);
  const failed = index.items.filter((item) => item.state === "failed")
    .map((item) => item.id);
  const paidProviderCanaryGap = index.paidProviderCanary.state !== "passed";
  return { ready: index.revisionManifest !== null
    && pending.length === 0 && failed.length === 0,
  pending, failed, paidProviderCanaryGap };
}
