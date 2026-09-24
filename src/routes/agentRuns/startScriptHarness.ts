import express from "express";
import { z } from "zod";

import {
  AGENT_RUN_START_SCHEMA_VERSION,
  AgentRunConflictError,
  AgentRunContentRejectedError,
  AgentRunProjectNotFoundError,
  projectAgentRunToChatMessage,
  READ_ONLY_AGENT_ROLE,
  SCRIPT_HARNESS_SCOPE,
  type AgentRuntime,
} from "@/agentRuntime";
import { ScriptHarnessOwnershipError, ScriptSkillSelectionError } from "@/agents/scriptAgent/harnessPreparation";
import { getDefaultScriptHarnessRuntime } from "@/agents/scriptAgent/harnessRuntime";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

/** Separate opt-in transport contract; legacy Script Socket and read-only Run endpoints remain intact. */
export function createStartScriptHarnessRouter(runtime: AgentRuntime) {
  const router = express.Router();
  return router.post("/", validateFields({
    schemaVersion: z.literal(AGENT_RUN_START_SCHEMA_VERSION),
    projectId: z.number().int().positive(), role: z.literal(READ_ONLY_AGENT_ROLE),
    scope: z.literal(SCRIPT_HARNESS_SCOPE),
    clientRequestId: z.string().trim().min(1).max(128),
    content: z.string().trim().min(1).max(20_000),
  }), async (req, res, next) => {
    const actorUserId = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
      res.status(403).send({ message: "操作人身份无效" }); return;
    }
    try {
      const run = await runtime.start({ ...req.body, actorUserId });
      res.status(200).send(success({ run, message: projectAgentRunToChatMessage(run) }));
    } catch (error) {
      if (error instanceof AgentRunContentRejectedError) {
        res.status(422).send({ message: error.message,
          violationCodes: error.violationCodes }); return;
      }
      if (error instanceof ScriptHarnessOwnershipError) {
        res.status(403).send({ message: error.message }); return;
      }
      if (error instanceof ScriptSkillSelectionError || error instanceof AgentRunConflictError) {
        res.status(409).send({ message: error.message }); return;
      }
      if (error instanceof AgentRunProjectNotFoundError) {
        res.status(404).send({ message: error.message }); return;
      }
      next(error);
    }
  });
}

export default createStartScriptHarnessRouter(getDefaultScriptHarnessRuntime());
