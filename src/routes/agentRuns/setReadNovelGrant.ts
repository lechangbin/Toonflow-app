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

/** Global JWT middleware supplies the actor; the request body cannot choose an owner. */
export function createSetReadNovelGrantRouter(grants: GrantRuntime) {
  const router = express.Router();
  return router.post("/", validateFields({ projectId: z.number().int().positive(),
    expectedVersion: z.number().int().nonnegative(), active: z.boolean() }),
  async (req, res, next) => {
    const actorUserId = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
      res.status(403).send({ message: "操作人身份无效" }); return;
    }
    try {
      const grant = await grants.setReadNovel({ ...req.body, actorUserId });
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

export default createSetReadNovelGrantRouter(createProjectSkillGrantRuntime({
  work: (operation) => getDatabaseRuntime().work(operation), now: () => Date.now(),
}));
