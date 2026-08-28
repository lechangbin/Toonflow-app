import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { loadVendorRuntime, validateVendorRequiredInputs } from "@/lib/vendorRuntime";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    id: z.string(),
    enable: z.number(),
  }),
  async (req, res) => {
    const { id, enable } = req.body;
    if (enable === 1) {
      const configured = await u.db("o_vendorConfig").where("id", id).first();
      if (!configured) throw new Error(`未找到供应商配置 id=${id}`);
      const runtime = loadVendorRuntime(u.vendor.getCode(id), {
        inputValues: JSON.parse(configured.inputValues ?? "{}"),
        customModels: JSON.parse(configured.models ?? "[]"),
      });
      validateVendorRequiredInputs(runtime.vendor);
    }
    await u.db("o_vendorConfig").where("id", id).update({ enable });
    res.status(200).send(success("更新成功"));
  },
);
