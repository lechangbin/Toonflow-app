import express from "express";
import { z } from "zod";

import {
  createStoryboardWriteApprovalRuntime, getDefaultStoryboardWriteApprovalRuntime,
  StoryboardApprovalConflictError,
} from "@/controlledTools/storyboardWriteApproval";
import { StoryboardWriteContractError } from "@/controlledTools/storyboardWriteContract";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

type Runtime = ReturnType<typeof createStoryboardWriteApprovalRuntime>;

function actorId(req: express.Request): number | null {
  const id = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function respondFailure(res: express.Response, error: unknown): boolean {
  if (error instanceof z.ZodError) {
    res.status(422).send({ message: "分镜候选不符合输入契约" });
    return true;
  }
  if (error instanceof StoryboardApprovalConflictError) {
    res.status(409).send({ message: "审批版本或操作身份已变化", reason: "conflict" });
    return true;
  }
  if (error instanceof StoryboardWriteContractError) {
    res.status(error.reason === "scope" ? 404 : 409)
      .send({ message: "分镜审批状态不可用，请刷新核对", reason: error.reason });
    return true;
  }
  return false;
}

/** Explicit Owner-local admission; model proposals use a separate authority seam. */
export function createStoryboardWriteApprovalRouter(runtime: Runtime) {
  const router = express.Router();
  router.post("/propose", validateFields({
    projectId: z.number().int().positive(),
    clientRequestId: z.string().min(1).max(128),
    operationId: z.string().min(1).max(128), payload: z.unknown(),
  }), async (req, res, next) => {
    const actorUserId = actorId(req);
    if (!actorUserId) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      res.status(200).send(success({ approval: await runtime.propose({
        ...req.body, actorUserId,
      }) }));
    } catch (error) { if (!respondFailure(res, error)) next(error); }
  });
  router.post("/inspect", validateFields({
    projectId: z.number().int().positive(), runId: z.string().min(1).max(128),
  }), async (req, res, next) => {
    const actorUserId = actorId(req);
    if (!actorUserId) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const approval = await runtime.inspect(req.body.projectId, req.body.runId, actorUserId);
      if (!approval) res.status(404).send({ message: "审批记录不存在" });
      else res.status(200).send(success({ approval }));
    } catch (error) { if (!respondFailure(res, error)) next(error); }
  });
  router.post("/decide", validateFields({
    projectId: z.number().int().positive(), runId: z.string().min(1).max(128),
    approvalId: z.string().min(1).max(128), clientCommandId: z.string().min(1).max(128),
    expectedVersion: z.number().int().positive(), decision: z.enum(["approve", "reject"]),
  }), async (req, res, next) => {
    const actorUserId = actorId(req);
    if (!actorUserId) { res.status(403).send({ message: "审批人身份无效" }); return; }
    try {
      const approval = await runtime.decide({ ...req.body, actorUserId });
      if (!approval) res.status(404).send({ message: "审批记录不存在" });
      else res.status(200).send(success({ approval }));
    } catch (error) { if (!respondFailure(res, error)) next(error); }
  });
  return router;
}

export default createStoryboardWriteApprovalRouter(getDefaultStoryboardWriteApprovalRuntime());
