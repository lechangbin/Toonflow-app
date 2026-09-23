import express from "express";
import { z } from "zod";

import {
  createDerivedAssetWriteRuntime,
  DerivedAssetCommandConflictError,
  DerivedAssetWriteRejectedError,
  getDefaultDerivedAssetWriteRuntime,
} from "@/controlledTools/derivedAssetWrite";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

type WriteRuntime = ReturnType<typeof createDerivedAssetWriteRuntime>;

function actorId(req: express.Request): number {
  return Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
}

export function createDerivedAssetApprovalRouter(runtime: WriteRuntime) {
  const router = express.Router();
  router.post("/propose", validateFields({
    projectId: z.number().int().positive(),
    clientRequestId: z.string().min(1).max(128),
    operationId: z.string().min(1).max(128),
    payload: z.unknown(),
  }), async (req, res, next) => {
    try {
      const actorUserId = actorId(req);
      if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
        res.status(403).send({ message: "操作人身份无效" }); return;
      }
      res.status(200).send(success({ approval: await runtime.propose({ ...req.body, actorUserId }) }));
    } catch (error) {
      if (error instanceof DerivedAssetWriteRejectedError) {
        res.status(error.reason === "scope" ? 404 : error.reason === "contract" ? 422 : 409)
          .send({ message: "衍生资产写入提案未通过校验", reason: error.reason });
      } else if (error instanceof DerivedAssetCommandConflictError) {
        res.status(409).send({ message: "提案身份与已保存的操作不一致" });
      } else next(error);
    }
  });
  router.post("/inspect", validateFields({
    projectId: z.number().int().positive(), runId: z.string().min(1).max(128),
  }), async (req, res, next) => {
    try {
      const approval = await runtime.inspect(req.body.projectId, req.body.runId, actorId(req));
      if (!approval) res.status(404).send({ message: "审批记录不存在" });
      else res.status(200).send(success({ approval }));
    } catch (error) {
      if (error instanceof DerivedAssetWriteRejectedError && error.reason === "scope") res.status(404).send({ message: "审批记录不存在" });
      else next(error);
    }
  });
  router.post("/list", validateFields({ projectId: z.number().int().positive() }), async (req, res, next) => {
    try {
      res.status(200).send(success({ approvals: await runtime.list(req.body.projectId, actorId(req)) }));
    } catch (error) {
      if (error instanceof DerivedAssetWriteRejectedError && error.reason === "scope") res.status(404).send({ message: "项目不存在" });
      else next(error);
    }
  });
  router.post("/decide", validateFields({
    projectId: z.number().int().positive(), runId: z.string().min(1).max(128),
    approvalId: z.string().min(1).max(128), clientCommandId: z.string().min(1).max(128),
    expectedVersion: z.number().int().positive(), decision: z.enum(["approve", "reject"]),
  }), async (req, res, next) => {
    try {
      const actorUserId = actorId(req);
      if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
        res.status(403).send({ message: "审批人身份无效" });
        return;
      }
      const approval = await runtime.decide({ ...req.body, actorUserId });
      if (!approval) res.status(404).send({ message: "审批记录不存在" });
      else res.status(200).send(success({ approval }));
    } catch (error) {
      if (error instanceof DerivedAssetWriteRejectedError && error.reason === "scope") {
        res.status(404).send({ message: "审批记录不存在" });
      } else if (error instanceof DerivedAssetCommandConflictError || error instanceof DerivedAssetWriteRejectedError) {
        res.status(409).send({ message: "审批状态已变化，请刷新后核对", reason: error instanceof DerivedAssetWriteRejectedError ? error.reason : "conflict" });
      } else next(error);
    }
  });
  return router;
}

export default createDerivedAssetApprovalRouter(getDefaultDerivedAssetWriteRuntime());
