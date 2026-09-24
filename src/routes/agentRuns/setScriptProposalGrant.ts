import express from "express";
import { z } from "zod";

import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  createProjectSkillGrantRuntime,
  ProjectSkillGrantOwnershipError,
  ProjectSkillGrantVersionConflictError,
} from "@/skillRuntime/grants";

type Grants = Pick<ReturnType<typeof createProjectSkillGrantRuntime>,
  "setProposeScriptWorkspace" | "setProposeScript">;

/** Owner grant for model proposals only; approval of each effect remains separate. */
export function createSetScriptProposalGrantRouter(grants: Grants) {
  const router = express.Router();
  return router.post("/", validateFields({ projectId: z.number().int().positive(),
    kind: z.enum(["workspace", "script"]),
    expectedVersion: z.number().int().nonnegative(), active: z.boolean() }),
  async (req, res, next) => {
    const actorUserId = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
      res.status(403).send({ message: "操作人身份无效" }); return;
    }
    try {
      const command = { projectId: req.body.projectId, actorUserId,
        expectedVersion: req.body.expectedVersion, active: req.body.active };
      const grant = req.body.kind === "workspace"
        ? await grants.setProposeScriptWorkspace(command)
        : await grants.setProposeScript(command);
      res.status(200).send(success(grant));
    } catch (error) {
      if (error instanceof ProjectSkillGrantOwnershipError) {
        res.status(403).send({ message: error.message }); return;
      }
      if (error instanceof ProjectSkillGrantVersionConflictError) {
        res.status(409).send({ message: error.message }); return;
      }
      next(error);
    }
  });
}

export default createSetScriptProposalGrantRouter(createProjectSkillGrantRuntime({
  work: (operation) => getDatabaseRuntime().work(operation), now: () => Date.now(),
}));
