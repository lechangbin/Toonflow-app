import express from "express";
import { z } from "zod";

import { loadVendorRuntime, type VendorRequestName } from "@/lib/vendorRuntime";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";

const router = express.Router();

export default router.post("/", async (req, res) => {
  try {
    const input = z.object({ id: z.string().min(1), tsCode: z.string().min(1) }).strict().parse(req.body);
    const current = await u.db("o_vendorConfig").where("id", input.id).first();
    if (!current) return res.status(404).send(error("供应商不存在"));
    const runtime = loadVendorRuntime(input.tsCode, {
      inputValues: JSON.parse(current.inputValues ?? "{}"),
      customModels: JSON.parse(current.models ?? "[]"),
    });
    if (runtime.vendor.id !== input.id) return res.status(400).send(error("Vendor id 不允许在更新时改变"));
    const requestByType: Record<string, VendorRequestName> = {
      text: "textRequest",
      image: "imageRequest",
      video: "videoRequest",
      tts: "ttsRequest",
    };
    for (const model of runtime.models) {
      const requestName = model.type ? requestByType[model.type] : undefined;
      if (requestName) runtime.getRequest(requestName, model.modelName);
    }
    u.vendor.writeCode(input.id, input.tsCode);
    res.status(200).send(success(runtime.vendor));
  } catch (cause) {
    res.status(400).send(error(u.error(cause).message));
  }
});
