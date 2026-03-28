import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    id: z.string(),
  }),
  async (req, res) => {
    const { id } = req.body;
    await u.db("o_vendorConfig").where("id", id).del();
    await u.db("o_agentDeploy").where("vendorId", id).update({
      model: null,
      key: null,
      vendorId: null,
    });
    res.status(200).send(success("删除成功"));
  },
);
