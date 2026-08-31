import express from "express";
import { z } from "zod";

import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    agentUseMode: z.string(),
  }),
  async (req, res) => {
    try {
      const { agentUseMode } = req.body;
      await getDefaultConfiguredVendor().configure({
        kind: "agent-mode",
        mode: agentUseMode === "1" ? "1" : "0",
      });
      res.status(200).send(success("保存设置成功"));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
