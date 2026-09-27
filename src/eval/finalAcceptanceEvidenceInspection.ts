import { computeFinalAcceptanceEvidenceHash } from "./finalAcceptanceEvidenceFiles";
import { validateFinalAcceptanceIndex, type FinalAcceptanceIndex } from
  "./finalAcceptanceIndex";

type AcceptanceItem = FinalAcceptanceIndex["items"][number];
export type AcceptanceEvidenceFileState =
  "not-claimed" | "hash-match" | "hash-mismatch" | "unreadable";

export interface AcceptanceEvidenceFileObservation {
  id: AcceptanceItem["id"];
  state: AcceptanceEvidenceFileState;
  observedHash: string | null;
}

/** Byte-level inspection only. A matching hash is never an acceptance or quality verdict. */
export async function inspectFinalAcceptanceEvidenceFiles(input: unknown, root: string): Promise<{
  observations: AcceptanceEvidenceFileObservation[];
  allClaimedHashesMatch: boolean;
}> {
  const index = validateFinalAcceptanceIndex(input);
  const observations: AcceptanceEvidenceFileObservation[] = [];
  for (const item of index.items) {
    if (item.state !== "passed") {
      observations.push({ id: item.id, state: "not-claimed", observedHash: null });
      continue;
    }
    try {
      const observedHash = await computeFinalAcceptanceEvidenceHash(root, item.evidenceRefs);
      observations.push({ id: item.id,
        state: observedHash === item.resultHash ? "hash-match" : "hash-mismatch",
        observedHash });
    } catch {
      observations.push({ id: item.id, state: "unreadable", observedHash: null });
    }
  }
  return { observations,
    allClaimedHashesMatch: observations.every((item) => item.state === "hash-match") };
}
