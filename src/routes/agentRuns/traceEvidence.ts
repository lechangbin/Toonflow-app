import express from "express";
import { z } from "zod";

import { AgentTraceExportUnavailableError, createAgentTraceEvidenceRuntime } from "@/agentRuntime/traceEvidence";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

type Runtime = ReturnType<typeof createAgentTraceEvidenceRuntime>;

export function createAgentTraceEvidenceRouter(runtime: Runtime) {
  const router = express.Router();
  router.post("/", validateFields({ projectId: z.number().int().positive(),
    runId: z.string().min(1).max(128) }), async (req, res, next) => {
    const actorUserId = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
      res.status(403).send({ message: "操作人身份无效" }); return;
    }
    try {
      const evidence = await runtime.export({ projectId: req.body.projectId,
        runId: req.body.runId, actorUserId });
      if (!evidence) res.status(404).send({ message: "Agent Run 不存在" });
      else res.status(200).send(success({ evidence }));
    } catch (error) {
      if (error instanceof AgentTraceExportUnavailableError) {
        res.status(409).send({ message: "安全证据不可用，请核对权限或持久化记录" });
      } else next(error);
    }
  });
  return router;
}

export default createAgentTraceEvidenceRouter(createAgentTraceEvidenceRuntime((operation) =>
  getDatabaseRuntime().work(operation)));
