import express from "express";
import { z } from "zod";

import { getDefaultAgentRuntime, projectAgentRunToChatMessage, type AgentRuntime } from "@/agentRuntime";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

export function createInspectAgentRunRouter(runtime: AgentRuntime) {
  const router = express.Router();
  return router.post(
    "/",
    validateFields({ runId: z.string().trim().min(1).max(128), projectId: z.number().int().positive() }),
    async (req, res, next) => {
      try {
        const run = await runtime.inspect(req.body);
        if (!run) {
          res.status(404).send({ message: "Agent Run 不存在" });
          return;
        }
        res.status(200).send(success({ run, message: projectAgentRunToChatMessage(run) }));
      } catch (error) {
        next(error);
      }
    },
  );
}

export default createInspectAgentRunRouter(getDefaultAgentRuntime());
