import express from "express";
import { z } from "zod";

import {
  AgentRunCommandConflictError,
  AgentRunStateConflictError,
  AgentRunVersionConflictError,
  getDefaultAgentRuntime,
  projectAgentRunToChatMessage,
  type AgentRuntime,
} from "@/agentRuntime";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

export function createCancelAgentRunRouter(runtime: AgentRuntime) {
  const router = express.Router();
  return router.post(
    "/",
    validateFields({
      runId: z.string().trim().min(1).max(128),
      projectId: z.number().int().positive(),
      clientCommandId: z.string().trim().min(1).max(128),
      expectedVersion: z.number().int().positive(),
    }),
    async (req, res, next) => {
      try {
        const run = await runtime.cancel(req.body);
        if (!run) {
          res.status(404).send({ message: "Agent Run 不存在" });
          return;
        }
        res.status(200).send(success({ run, message: projectAgentRunToChatMessage(run) }));
      } catch (error) {
        if (error instanceof AgentRunCommandConflictError
          || error instanceof AgentRunVersionConflictError
          || error instanceof AgentRunStateConflictError) {
          res.status(409).send({ message: error.message });
          return;
        }
        next(error);
      }
    },
  );
}

export default createCancelAgentRunRouter(getDefaultAgentRuntime());
