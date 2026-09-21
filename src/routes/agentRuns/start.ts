import express from "express";
import { z } from "zod";

import {
  AGENT_RUN_START_SCHEMA_VERSION,
  AgentRunContentRejectedError,
  AgentRunConflictError,
  AgentRunProjectNotFoundError,
  getDefaultAgentRuntime,
  projectAgentRunToChatMessage,
  READ_ONLY_AGENT_ROLE,
  READ_ONLY_AGENT_SCOPE,
  type AgentRuntime,
} from "@/agentRuntime";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

export function createStartAgentRunRouter(runtime: AgentRuntime) {
  const router = express.Router();
  return router.post(
    "/",
    validateFields({
      schemaVersion: z.literal(AGENT_RUN_START_SCHEMA_VERSION),
      projectId: z.number().int().positive(),
      role: z.literal(READ_ONLY_AGENT_ROLE),
      scope: z.literal(READ_ONLY_AGENT_SCOPE),
      clientRequestId: z.string().trim().min(1).max(128),
      content: z.string().trim().min(1).max(20_000),
    }),
    async (req, res, next) => {
      try {
        const run = await runtime.start(req.body);
        res.status(200).send(success({ run, message: projectAgentRunToChatMessage(run) }));
      } catch (error) {
        if (error instanceof AgentRunContentRejectedError) {
          res.status(422).send({ message: error.message, violationCodes: error.violationCodes });
          return;
        }
        if (error instanceof AgentRunConflictError) {
          res.status(409).send({ message: error.message });
          return;
        }
        if (error instanceof AgentRunProjectNotFoundError) {
          res.status(404).send({ message: error.message });
          return;
        }
        next(error);
      }
    },
  );
}

export default createStartAgentRunRouter(getDefaultAgentRuntime());
