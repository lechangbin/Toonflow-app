import express from "express";
import { z } from "zod";

import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { createProjectSkillGrantRuntime,
  ProjectSkillGrantOwnershipError } from "@/skillRuntime/grants";

type GrantRuntime = ReturnType<typeof createProjectSkillGrantRuntime>;

export function createGetProductionGrantsRouter(grants: Pick<GrantRuntime, "inspectProduction">) {
  const router = express.Router();
  return router.post("/", validateFields({ projectId: z.number().int().positive() }),
    async (req, res, next) => {
      const actorUserId = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
      if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
        res.status(403).send({ message: "操作人身份无效" }); return;
      }
      try {
        res.status(200).send(success(await grants.inspectProduction(req.body.projectId,
          actorUserId)));
      } catch (error) {
        if (error instanceof ProjectSkillGrantOwnershipError) {
          res.status(403).send({ message: error.message }); return;
        }
        next(error);
      }
    });
}

export default createGetProductionGrantsRouter(createProjectSkillGrantRuntime({
  work: (operation) => getDatabaseRuntime().work(operation), now: () => Date.now(),
}));
