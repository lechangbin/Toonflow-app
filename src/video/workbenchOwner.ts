import type express from "express";

import { getDatabaseRuntime, type DatabaseWork } from "@/database";

export class WorkbenchOwnerRejectedError extends Error {
  constructor() { super("Workbench action requires the Project Owner"); }
}

export type WorkbenchOwnerCheck = (req: express.Request, projectId: number) => Promise<void>;

export function createWorkbenchOwnerCheck(
  work: DatabaseWork = (operation) => getDatabaseRuntime().work(operation),
): WorkbenchOwnerCheck {
  return async (req, projectId) => {
    const actorUserId = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0
      || !Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new WorkbenchOwnerRejectedError();
    }
    const project = await work((db) => db("o_project")
      .where({ id: projectId, userId: actorUserId }).first("id"));
    if (!project) throw new WorkbenchOwnerRejectedError();
  };
}

export const assertWorkbenchProjectOwner = createWorkbenchOwnerCheck();
