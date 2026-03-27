import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.array(z.number()),
  }),
  async (req, res) => {
    const { id } = req.body;
    await u.db("o_agentDeploy").whereIn("id", id).where("disabled", "<>", 1).update({
      model: "gpt-4.1",
      modelName: "toonflow:gpt-4.1",
      vendorId: 1,
    });
    res.status(200).send(success("配置成功"));
  },
);
