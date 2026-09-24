import express from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";

import { createVideoQuotePolicy, VideoQuotePolicyConflictError,
  videoQuoteTargetSchema } from "@/controlledTools/videoQuotePolicy";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

type Policy = ReturnType<typeof createVideoQuotePolicy>;
const target = videoQuoteTargetSchema.shape;

function requestedTarget(body: Record<string, unknown>) {
  return videoQuoteTargetSchema.parse({ projectId: body.projectId,
    vendorId: body.vendorId, modelId: body.modelId,
    capabilityId: body.capabilityId, output: body.output, audio: body.audio });
}

function actorId(req: express.Request): number {
  return Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
}

export function createVideoQuoteRouter(policy: Policy) {
  const router = express.Router();
  router.post("/get", validateFields(target), async (req, res, next) => {
    const actorUserId = actorId(req);
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
      res.status(403).send({ message: "操作人身份无效" }); return;
    }
    try { res.send(success({ quote: await policy.get(requestedTarget(req.body), actorUserId) })); }
    catch (error) {
      if (error instanceof VideoQuotePolicyConflictError) {
        res.status(409).send({ message: "视频估算的状态或授权已变化，请刷新后核对" });
      } else next(error);
    }
  });
  router.post("/set", validateFields({ ...target,
    expectedRevision: z.number().int().nonnegative(),
    estimatedMaxCostMicros: z.number().int().positive().max(1_000_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/u) }), async (req, res, next) => {
    const actorUserId = actorId(req);
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
      res.status(403).send({ message: "操作人身份无效" }); return;
    }
    try { res.send(success({ quote: await policy.set({ ...req.body, actorUserId }) })); }
    catch (error) {
      if (error instanceof VideoQuotePolicyConflictError) {
        res.status(409).send({ message: "视频估算的状态或授权已变化，请刷新后核对" });
      } else next(error);
    }
  });
  return router;
}

export default createVideoQuoteRouter(createVideoQuotePolicy({
  work: (operation) => getDatabaseRuntime().work(operation),
  now: () => Date.now(), createId: uuid,
}));
