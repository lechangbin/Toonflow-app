import express from "express";
import { z } from "zod";

import {
  AgentRunCommandConflictError,
  AgentRunStateConflictError,
  AgentRunVersionConflictError,
  projectAgentRunToChatMessage,
  READ_ONLY_AGENT_ROLE,
  SCRIPT_HARNESS_SCOPE,
  type AgentRuntime,
} from "@/agentRuntime";
import { getDefaultScriptHarnessRuntime } from "@/agents/scriptAgent/harnessRuntime";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

function actorUserId(req: express.Request): number | null {
  const id = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Owner-scoped inspect/list/cancel for opt-in Script Harness Runs. */
export function createScriptHarnessControlsRouter(runtime: AgentRuntime) {
  const router = express.Router();
  router.post("/inspect", validateFields({ projectId: z.number().int().positive(),
    runId: z.string().trim().min(1).max(128) }), async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const run = await runtime.inspect({ ...req.body, actorUserId: actor });
      if (!run || run.scope !== SCRIPT_HARNESS_SCOPE) {
        res.status(404).send({ message: "Script Harness Run 不存在" }); return;
      }
      res.status(200).send(success({ run, message: projectAgentRunToChatMessage(run) }));
    } catch (error) { next(error); }
  });
  router.post("/list", validateFields({ projectId: z.number().int().positive(),
    role: z.literal(READ_ONLY_AGENT_ROLE), scope: z.literal(SCRIPT_HARNESS_SCOPE) }),
  async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const result = await runtime.list({ ...req.body, actorUserId: actor });
      res.status(200).send(success({ ...result,
        currentMessage: result.current ? projectAgentRunToChatMessage(result.current) : null,
        recentMessages: result.recent.map(projectAgentRunToChatMessage) }));
    } catch (error) { next(error); }
  });
  router.post("/cancel", validateFields({ projectId: z.number().int().positive(),
    runId: z.string().trim().min(1).max(128),
    clientCommandId: z.string().trim().min(1).max(128),
    expectedVersion: z.number().int().positive() }), async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const inspected = await runtime.inspect({ runId: req.body.runId,
        projectId: req.body.projectId, actorUserId: actor });
      if (!inspected || inspected.scope !== SCRIPT_HARNESS_SCOPE) {
        res.status(404).send({ message: "Script Harness Run 不存在" }); return;
      }
      const run = await runtime.cancel({ ...req.body, actorUserId: actor });
      if (!run) { res.status(404).send({ message: "Script Harness Run 不存在" }); return; }
      res.status(200).send(success({ run, message: projectAgentRunToChatMessage(run) }));
    } catch (error) {
      if (error instanceof AgentRunCommandConflictError
        || error instanceof AgentRunVersionConflictError
        || error instanceof AgentRunStateConflictError) {
        res.status(409).send({ message: error.message }); return;
      }
      next(error);
    }
  });
  return router;
}

export default createScriptHarnessControlsRouter(getDefaultScriptHarnessRuntime());
