import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    if (id == 1) {
      return res.status(400).send(error("此配置无法删除"));
    }
    await u.db("o_vendorConfig").where("id", id).del();
    res.status(200).send(success("删除成功"));
  },
);
