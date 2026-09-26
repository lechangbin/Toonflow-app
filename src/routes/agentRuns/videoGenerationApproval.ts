import express from "express";
import { z } from "zod";

import { createDefaultVideoGenerationApprovalRuntime } from
  "@/controlledTools/videoGenerationApprovalComposition";
import { VideoGenerationApprovalConflictError } from
  "@/controlledTools/videoGenerationApproval";
import { VideoApprovalScopeConflictError } from "@/controlledTools/videoApprovalScope";
import { VideoGenerationProposalContractError,
  videoGenerationProposalInput } from "@/controlledTools/videoGenerationProposalContract";
import { VideoQuotePolicyConflictError } from "@/controlledTools/videoQuotePolicy";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

type Runtime = ReturnType<typeof createDefaultVideoGenerationApprovalRuntime>;
const projectId = z.number().int().positive();
const id = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);

function actor(req: express.Request, res: express.Response): number | null {
  const value = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
  if (!Number.isSafeInteger(value) || value <= 0) {
    res.status(403).send({ message: "操作人身份无效" }); return null;
  }
  return value;
}

function fail(res: express.Response, next: express.NextFunction, error: unknown) {
  if (error instanceof VideoGenerationApprovalConflictError
    || error instanceof VideoApprovalScopeConflictError
    || error instanceof VideoGenerationProposalContractError
    || error instanceof VideoQuotePolicyConflictError) {
    res.status(409).send({ message: "视频审批的目标、报价或授权已变化，请刷新后核对" });
  } else next(error);
}

/** Exposes Owner review only. There is intentionally no execute endpoint. */
export function createVideoGenerationApprovalRouter(runtime: Runtime) {
  const router = express.Router();
  router.post("/propose", validateFields({ projectId, clientRequestId: id,
    operationId: id, payload: videoGenerationProposalInput }), async (req, res, next) => {
    const actorUserId = actor(req, res); if (actorUserId === null) return;
    try { res.send(success({ approval: await runtime.propose({ ...req.body, actorUserId }) })); }
    catch (error) { fail(res, next, error); }
  });
  router.post("/inspect", validateFields({ projectId, runId: id }), async (req, res, next) => {
    const actorUserId = actor(req, res); if (actorUserId === null) return;
    try {
      const approval = await runtime.inspect(req.body.projectId, req.body.runId, actorUserId);
      if (!approval) res.status(404).send({ message: "审批不存在" });
      else res.send(success({ approval }));
    } catch (error) { fail(res, next, error); }
  });
  router.post("/list", validateFields({ projectId }), async (req, res, next) => {
    const actorUserId = actor(req, res); if (actorUserId === null) return;
    try { res.send(success({ approvals: await runtime.list(req.body.projectId, actorUserId) })); }
    catch (error) { fail(res, next, error); }
  });
  router.post("/decide", validateFields({ projectId, runId: id, approvalId: id,
    clientCommandId: id, expectedVersion: z.number().int().positive(),
    decision: z.enum(["approve", "reject"]) }), async (req, res, next) => {
    const actorUserId = actor(req, res); if (actorUserId === null) return;
    try {
      const approval = await runtime.decide({ ...req.body, actorUserId });
      if (!approval) res.status(404).send({ message: "审批不存在" });
      else res.send(success({ approval }));
    } catch (error) { fail(res, next, error); }
  });
  return router;
}

export default createVideoGenerationApprovalRouter(
  createDefaultVideoGenerationApprovalRuntime());
