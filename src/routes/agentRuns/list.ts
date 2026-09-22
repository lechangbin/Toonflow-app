import express from "express";
import { z } from "zod";

import {
  getDefaultAgentRuntime,
  projectAgentRunToChatMessage,
  READ_ONLY_AGENT_ROLE,
  READ_ONLY_AGENT_SCOPE,
  type AgentRuntime,
} from "@/agentRuntime";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

export function createListAgentRunsRouter(runtime: AgentRuntime) {
  const router = express.Router();
  return router.post(
    "/",
    validateFields({
      projectId: z.number().int().positive(),
      role: z.literal(READ_ONLY_AGENT_ROLE),
      scope: z.literal(READ_ONLY_AGENT_SCOPE),
    }),
    async (req, res, next) => {
      try {
        const result = await runtime.list(req.body);
        res.status(200).send(success({
          ...result,
          currentMessage: result.current ? projectAgentRunToChatMessage(result.current) : null,
          recentMessages: result.recent.map(projectAgentRunToChatMessage),
        }));
      } catch (error) {
        next(error);
      }
    },
  );
}

export default createListAgentRunsRouter(getDefaultAgentRuntime());
