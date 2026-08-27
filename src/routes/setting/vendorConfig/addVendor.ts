import express from "express";
import { z } from "zod";

import { loadVendorRuntime, type VendorRequestName } from "@/lib/vendorRuntime";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";

const router = express.Router();

function validateRequestExports(runtime: ReturnType<typeof loadVendorRuntime>): void {
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
}

export default router.post("/", async (req, res) => {
  try {
    const { tsCode } = z.object({ tsCode: z.string().min(1) }).strict().parse(req.body);
    const runtime = loadVendorRuntime(tsCode);
    validateRequestExports(runtime);
    if (runtime.vendor.id.includes(":")) return res.status(400).send(error("id不能包含英文冒号"));
    if (await u.db("o_vendorConfig").where("id", runtime.vendor.id).first()) {
      return res.status(409).send(error("供应商id已存在"));
    }
    await u.db("o_vendorConfig").insert({
      id: runtime.vendor.id,
      inputValues: JSON.stringify(runtime.vendor.inputValues),
      models: "[]",
      enable: 0,
    });
    u.vendor.writeCode(runtime.vendor.id, tsCode);
    res.status(200).send(success(runtime.vendor));
  } catch (cause) {
    res.status(400).send(error(u.error(cause).message));
  }
});
