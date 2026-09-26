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

type GrantRuntime = ReturnType<typeof createProjectSkillGrantRuntime>;

/** Explicit Owner grant for existing Script content; separate from workspace and novel. */
export function createSetReadScriptGrantRouter(grants: Pick<GrantRuntime, "setReadScript">) {
  const router = express.Router();
  return router.post("/", validateFields({ projectId: z.number().int().positive(),
    expectedVersion: z.number().int().nonnegative(), active: z.boolean() }),
  async (req, res, next) => {
    const actorUserId = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
      res.status(403).send({ message: "操作人身份无效" }); return;
    }
    try {
      const grant = await grants.setReadScript({ ...req.body, actorUserId });
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

export default createSetReadScriptGrantRouter(createProjectSkillGrantRuntime({
  work: (operation) => getDatabaseRuntime().work(operation), now: () => Date.now(),
}));
