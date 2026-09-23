import express from "express";
import { z } from "zod";

import { createDefaultBillableImageRuntime } from "@/controlledTools/billableImageComposition";
import { BillableImageLedgerConflictError } from "@/controlledTools/billableImageLedger";
import { BillableImagePreflightError } from "@/controlledTools/billableImagePreflight";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

type Runtime = ReturnType<typeof createDefaultBillableImageRuntime>;

function actorId(req: express.Request): number {
  return Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
}

function withActor(req: express.Request, res: express.Response): number | null {
  const id = actorId(req);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(403).send({ message: "操作人身份无效" }); return null; }
  return id;
}

function fail(res: express.Response, error: unknown, next: express.NextFunction): void {
  if (error instanceof BillableImageLedgerConflictError || error instanceof BillableImagePreflightError) {
    res.status(409).send({ message: "计费图片操作的状态或授权已变化，请刷新后核对" });
  } else next(error);
}

const targetFields = { projectId: z.number().int().positive(), assetId: z.number().int().positive(),
  vendorId: z.string().min(1).max(100), modelId: z.string().min(1).max(100),
  resolution: z.string().min(1).max(100) };

export function createBillableImageRouter(runtime: Runtime) {
  const router = express.Router();
  router.post("/quote/get", validateFields({ projectId: targetFields.projectId,
    vendorId: targetFields.vendorId, modelId: targetFields.modelId, resolution: targetFields.resolution }),
  async (req, res, next) => {
    const actorUserId = withActor(req, res); if (actorUserId === null) return;
    try { res.send(success({ quote: await runtime.quotePolicy.get(req.body, actorUserId) })); }
    catch (error) { fail(res, error, next); }
  });
  router.post("/quote/set", validateFields({ projectId: targetFields.projectId,
    vendorId: targetFields.vendorId, modelId: targetFields.modelId, resolution: targetFields.resolution,
    estimatedMaxCostMicros: z.number().int().positive().max(1_000_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/), expectedRevision: z.number().int().nonnegative() }),
  async (req, res, next) => {
    const actorUserId = withActor(req, res); if (actorUserId === null) return;
    try { res.send(success({ quote: await runtime.quotePolicy.set({ ...req.body, actorUserId }) })); }
    catch (error) { fail(res, error, next); }
  });
  router.post("/propose", validateFields({ ...targetFields,
    clientRequestId: z.string().min(1).max(128), operationId: z.string().min(1).max(128) }),
  async (req, res, next) => {
    const actorUserId = withActor(req, res); if (actorUserId === null) return;
    try { res.send(success({ approval: await runtime.approval.propose({ ...req.body, actorUserId }) })); }
    catch (error) { fail(res, error, next); }
  });
  router.post("/list", validateFields({ projectId: targetFields.projectId }), async (req, res, next) => {
    const actorUserId = withActor(req, res); if (actorUserId === null) return;
    try { res.send(success({ approvals: await runtime.approval.list(req.body.projectId, actorUserId) })); }
    catch (error) { fail(res, error, next); }
  });
  router.post("/inspect", validateFields({ projectId: targetFields.projectId,
    runId: z.string().min(1).max(128) }), async (req, res, next) => {
    const actorUserId = withActor(req, res); if (actorUserId === null) return;
    try {
      const approval = await runtime.approval.inspect(req.body.projectId, req.body.runId, actorUserId);
      if (!approval) res.status(404).send({ message: "操作不存在" });
      else res.send(success({ approval }));
    } catch (error) { fail(res, error, next); }
  });
  router.post("/decide", validateFields({ projectId: targetFields.projectId,
    runId: z.string().min(1).max(128), approvalId: z.string().min(1).max(128),
    clientCommandId: z.string().min(1).max(128), expectedVersion: z.number().int().positive(),
    decision: z.enum(["approve", "reject"]) }), async (req, res, next) => {
    const actorUserId = withActor(req, res); if (actorUserId === null) return;
    try {
      const approval = await runtime.approval.decide({ ...req.body, actorUserId });
      if (!approval) res.status(404).send({ message: "操作不存在" });
      else res.send(success({ approval }));
    } catch (error) { fail(res, error, next); }
  });
  router.post("/execute", validateFields({ projectId: targetFields.projectId,
    runId: z.string().min(1).max(128), approvalId: z.string().min(1).max(128),
    expectedVersion: z.number().int().positive() }), async (req, res, next) => {
    const actorUserId = withActor(req, res); if (actorUserId === null) return;
    try {
      const scope = await runtime.approval.approvedScope(req.body.projectId, req.body.runId,
        req.body.approvalId, actorUserId);
      const result = await runtime.execute({ projectId: req.body.projectId, runId: req.body.runId,
        approvalId: req.body.approvalId, expectedVersion: req.body.expectedVersion, actorUserId, scope });
      res.send(success({ result }));
    } catch (error) { fail(res, error, next); }
  });
  router.post("/cancel", validateFields({ projectId: targetFields.projectId,
    requestId: z.string().min(1).max(128), expectedVersion: z.number().int().positive() }),
  async (req, res, next) => {
    const actorUserId = withActor(req, res); if (actorUserId === null) return;
    try { await runtime.ledger.requestCancellation({ ...req.body, actorUserId }); res.send(success()); }
    catch (error) { fail(res, error, next); }
  });
  router.post("/artifact", validateFields({ projectId: targetFields.projectId,
    requestId: z.string().min(1).max(128) }), async (req, res, next) => {
    const actorUserId = withActor(req, res); if (actorUserId === null) return;
    try { res.send(success({ artifact: await runtime.artifact.inspect(req.body.projectId,
      actorUserId, req.body.requestId) })); }
    catch (error) { fail(res, error, next); }
  });
  return router;
}

export default createBillableImageRouter(createDefaultBillableImageRuntime());
