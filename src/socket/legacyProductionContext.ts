function positiveId(value: unknown): number | null {
  const id = typeof value === "string" && /^[1-9]\d*$/u.test(value) ? Number(value) : value;
  return Number.isSafeInteger(id) && (id as number) > 0 ? id as number : null;
}

/** The unselected episode is accepted for connection only, never for a chat. */
export async function authorizeLegacyProductionContext(input: {
  actorUserId: number | null;
  projectId: unknown;
  scriptId: unknown;
  isolationKey: unknown;
}, ownsProject: (projectId: number, actorUserId: number) => Promise<boolean>,
ownsScript: (projectId: number, scriptId: number) => Promise<boolean>): Promise<{
  projectId: number; scriptId: number | null; isolationKey: string;
} | null> {
  const actorUserId = positiveId(input.actorUserId);
  const projectId = positiveId(input.projectId);
  const scriptId = input.scriptId == null ? null : positiveId(input.scriptId);
  if (actorUserId === null || projectId === null || (input.scriptId != null && scriptId === null)) return null;
  const expectedKey = `${projectId}:productionAgent:${scriptId ?? "undefined"}`;
  if (input.isolationKey !== expectedKey || !await ownsProject(projectId, actorUserId)) return null;
  if (scriptId !== null && !await ownsScript(projectId, scriptId)) return null;
  return { projectId, scriptId, isolationKey: expectedKey };
}
