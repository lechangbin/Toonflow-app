import { createHash, createHmac } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";

import { validateAgentRuntimeCorpus } from "./agentRuntimeCorpus";
import { createEvaluationRunRuntime } from "./evaluationRun";

type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const pairKey = (caseId: string, seed: number) => `${caseId}:${seed}`;

/** Makes a blind, full-denominator reviewer packet and a separate private unblinding map. */
export async function createRuntimeCorpusBlindReviewBatch(input: {
  work: DatabaseWork; evaluation: Evaluation; evaluationRunId: string;
  blindingKey: Buffer;
}) {
  if (!Buffer.isBuffer(input.blindingKey) || input.blindingKey.length < 32) {
    throw new TypeError("Blind review requires a private 256-bit key");
  }
  const observed = await input.evaluation.inspect(input.evaluationRunId);
  if (!observed.manifest.agentRuntimeCorpusJson) {
    throw new TypeError("Blind review requires a frozen AgentRuntime corpus");
  }
  const corpus = validateAgentRuntimeCorpus(JSON.parse(observed.manifest.agentRuntimeCorpusJson) as unknown);
  const hmac = (label: string) => createHmac("sha256", input.blindingKey)
    .update(`${input.evaluationRunId}:${label}`).digest();
  const cells = new Map(observed.cases.map((cell) =>
    [`${cell.variant}:${pairKey(cell.caseId, cell.seed)}`, cell]));
  const packets = [];
  const privateMap = [];
  for (const definition of corpus.cases) {
    for (const seed of observed.manifest.seeds) {
      const pairId = `pair-${hmac(`pair:${pairKey(definition.id, seed)}`).toString("hex").slice(0, 24)}`;
      const reverse = (hmac(`order:${pairKey(definition.id, seed)}`)[0] & 1) === 1;
      const order = reverse ? ["candidate", "baseline"] as const
        : ["baseline", "candidate"] as const;
      for (const [index, variant] of order.entries()) {
        const side = index === 0 ? "A" as const : "B" as const;
        const cell = cells.get(`${variant}:${pairKey(definition.id, seed)}`);
        const outputRows = cell?.runStatus === "succeeded"
          ? await input.work((db) => db("o_agentRunOutput")
            .where({ runId: cell.agentRunId }).select("content", "contentHash")) : [];
        if (cell?.runStatus === "succeeded"
          && (outputRows.length !== 1 || typeof outputRows[0]?.content !== "string"
            || !inspectPersistableText(outputRows[0].content).ok
            || outputRows[0].contentHash !== hash(JSON.stringify(outputRows[0].content))
            || outputRows[0].contentHash !== cell.outputHash)) {
          throw new Error("Blind review source Output is missing, changed or unsafe");
        }
        const reviewToken = `review-${hmac(`token:${pairId}:${side}`).toString("hex").slice(0, 32)}`;
        const state = !cell ? "missing-run" as const
          : cell.runStatus !== "succeeded" ? "run-failed" as const : "ready" as const;
        packets.push({ pairId, side, reviewToken, state,
          request: definition.content, rubric: definition.rubric,
          sourceFixtureSha256: definition.fixture.sha256,
          response: state === "ready" ? outputRows[0].content : null });
        privateMap.push({ pairId, side, reviewToken,
          evaluationRunId: input.evaluationRunId, variant,
          caseId: definition.id, seed, agentRunId: cell?.agentRunId ?? null,
          sourceEvidenceHash: cell ? hash(JSON.stringify(cell)) : null,
          outputHash: state === "ready" ? outputRows[0].contentHash : null });
      }
    }
  }
  return { schemaVersion: "toonflow.runtime-corpus-blind-review.v1" as const,
    evaluationRunId: input.evaluationRunId, caseManifestHash: observed.manifest.caseManifestHash,
    expectedPairs: packets.length / 2, expectedSides: packets.length,
    packets, privateMap };
}
