import express from "express";
import { z, ZodError } from "zod";

import {
  createScriptWriteApprovalRuntime,
  getDefaultScriptWriteApprovalRuntime,
  ScriptWriteProposalConflictError,
  ScriptWriteProposalRejectedError,
} from "@/controlledTools/scriptWriteApproval";
import { ScriptWriteContentRejectedError } from "@/controlledTools/scriptWriteContract";
import { ScriptWriteTargetConflictError } from "@/controlledTools/scriptWriteState";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

type Runtime = ReturnType<typeof createScriptWriteApprovalRuntime>;

function actorUserId(req: express.Request): number | null {
  const id = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function handleError(error: unknown, res: express.Response, next: express.NextFunction) {
  if (error instanceof ScriptWriteProposalRejectedError) {
    const status = error.reason === "scope" ? 403 : error.reason === "contract" ? 400 : 409;
    res.status(status).send({ message: error.message }); return;
  }
  if (error instanceof ScriptWriteProposalConflictError
    || error instanceof ScriptWriteTargetConflictError) {
    res.status(409).send({ message: error.message }); return;
  }
  if (error instanceof ZodError || error instanceof ScriptWriteContentRejectedError) {
    res.status(422).send({ message: "Script write payload is invalid" }); return;
  }
  next(error);
}

/** Authenticated transport only; no browser input can choose the approving actor. */
export function createScriptWriteApprovalsRouter(runtime: Runtime) {
  const router = express.Router();
  router.post("/propose", validateFields({
    projectId: z.number().int().positive(),
    clientRequestId: z.string().trim().min(1).max(128),
    operationId: z.string().trim().min(1).max(128),
    kind: z.enum(["workspace", "script"]), payload: z.unknown(),
  }), async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      res.status(200).send(success(await runtime.propose({ ...req.body, actorUserId: actor })));
    } catch (error) { handleError(error, res, next); }
  });
  router.post("/inspect", validateFields({ projectId: z.number().int().positive(),
    runId: z.string().trim().min(1).max(128) }), async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const snapshot = await runtime.inspect(req.body.projectId, req.body.runId, actor);
      if (!snapshot) { res.status(404).send({ message: "Script write Run 不存在" }); return; }
      res.status(200).send(success(snapshot));
    } catch (error) { handleError(error, res, next); }
  });
  router.post("/list", validateFields({ projectId: z.number().int().positive() }),
    async (req, res, next) => {
      const actor = actorUserId(req);
      if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
      try {
        res.status(200).send(success(await runtime.list(req.body.projectId, actor)));
      } catch (error) { handleError(error, res, next); }
    });
  router.post("/decide", validateFields({ projectId: z.number().int().positive(),
    runId: z.string().trim().min(1).max(128),
    approvalId: z.string().trim().min(1).max(128),
    clientCommandId: z.string().trim().min(1).max(128),
    expectedVersion: z.number().int().positive(),
    decision: z.enum(["approve", "reject"]) }), async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const snapshot = await runtime.decide({ ...req.body, actorUserId: actor });
      if (!snapshot) { res.status(404).send({ message: "Script write Run 不存在" }); return; }
      res.status(200).send(success(snapshot));
    } catch (error) { handleError(error, res, next); }
  });
  return router;
}

export default createScriptWriteApprovalsRouter(getDefaultScriptWriteApprovalRuntime());
