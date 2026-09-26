import express from "express";
import { z } from "zod";

import { VideoApprovalScopeConflictError } from
  "@/controlledTools/videoApprovalScope";
import { VideoGenerationApprovalConflictError } from
  "@/controlledTools/videoGenerationApproval";
import { VideoGenerationExecutionConflictError } from
  "@/controlledTools/videoGenerationExecution";
import { createDefaultVideoGenerationExecutionComposition } from
  "@/controlledTools/videoGenerationExecutionComposition";
import { VideoGenerationProposalContractError } from
  "@/controlledTools/videoGenerationProposalContract";
import { VideoQuotePolicyConflictError } from
  "@/controlledTools/videoQuotePolicy";
import { VideoRequestLedgerConflictError } from
  "@/controlledTools/videoRequestLedger";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

type Runtime = ReturnType<typeof createDefaultVideoGenerationExecutionComposition>;
const projectId = z.number().int().positive();
const id = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
const expectedVersion = z.number().int().positive();

function actor(req: express.Request, res: express.Response): number | null {
  const value = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
  if (!Number.isSafeInteger(value) || value <= 0) {
    res.status(403).send({ message: "操作人身份无效" }); return null;
  }
  return value;
}

function fail(res: express.Response, next: express.NextFunction, error: unknown): void {
  if (error instanceof VideoRequestLedgerConflictError
    || error instanceof VideoGenerationApprovalConflictError
    || error instanceof VideoApprovalScopeConflictError
    || error instanceof VideoGenerationExecutionConflictError
    || error instanceof VideoGenerationProposalContractError
    || error instanceof VideoQuotePolicyConflictError) {
    res.status(409).send({ message: "视频请求的审批、目标或证据状态已变化，请检查原请求后再操作" });
  } else next(error);
}

/** Explicit operator gate; default installation exposes no billable dispatch action. */
export function createVideoGenerationExecutionRouter(runtime: Runtime,
  enabled: () => boolean) {
  const router = express.Router();
  router.use((_req, res, next) => {
    if (!enabled()) res.status(404).send({ message: "受控视频执行未启用" });
    else next();
  });
  router.post("/execute", validateFields({ projectId, runId: id,
    approvalId: id, expectedVersion }), async (req, res, next) => {
    const actorUserId = actor(req, res); if (actorUserId === null) return;
    try { res.send(success({ result: await runtime.execution.execute({
      ...req.body, actorUserId }) })); }
    catch (error) { fail(res, next, error); }
  });
  router.post("/cancel", validateFields({ projectId, requestId: id,
    expectedVersion }), async (req, res, next) => {
    const actorUserId = actor(req, res); if (actorUserId === null) return;
    try { await runtime.ledger.requestCancellation({ ...req.body, actorUserId });
      res.send(success()); }
    catch (error) { fail(res, next, error); }
  });
  router.post("/stop", validateFields({ projectId, requestId: id,
    expectedVersion }), async (req, res, next) => {
    const actorUserId = actor(req, res); if (actorUserId === null) return;
    try { await runtime.ledger.stopWithoutReplay({ ...req.body, actorUserId });
      res.send(success()); }
    catch (error) { fail(res, next, error); }
  });
  router.post("/commit", validateFields({ projectId, requestId: id,
    expectedVersion }), async (req, res, next) => {
    const actorUserId = actor(req, res); if (actorUserId === null) return;
    try { res.send(success({ output: await runtime.commit.commit({
      ...req.body, actorUserId }) })); }
    catch (error) { fail(res, next, error); }
  });
  router.post("/artifact/recover", validateFields({ projectId,
    requestId: id }), async (req, res, next) => {
    const actorUserId = actor(req, res); if (actorUserId === null) return;
    try { res.send(success({ artifact: await runtime.artifact.recoverPending(
      req.body.projectId, actorUserId, req.body.requestId) })); }
    catch (error) { fail(res, next, error); }
  });
  return router;
}

export default createVideoGenerationExecutionRouter(
  createDefaultVideoGenerationExecutionComposition(),
  () => process.env.TOONFLOW_CONTROLLED_VIDEO_EXECUTION === "enabled");
