import express from "express";
import { z } from "zod";
import { getDatabaseRuntime, type DatabaseWork } from "@/database";
import { getDefaultConfiguredVendor, parseVendorModelName } from "@/vendor";
import { validateFields } from "@/middleware/middleware";
import { success } from "@/lib/responseFormat";

/** Narrow project preference update: never resubmit or overwrite unrelated project fields. */
export function createSetImageModelRouter(
  work: DatabaseWork = operation => getDatabaseRuntime().work(operation),
  inspect = (vendorId: string) => getDefaultConfiguredVendor().inspectVendor(vendorId),
) {
  const router = express.Router();
  router.post("/", validateFields({ projectId: z.number().int().positive(), imageModel: z.string().min(1) }), async (req, res) => {
    const { projectId, imageModel } = req.body;
    try {
      const { vendorId, modelId } = parseVendorModelName(imageModel);
      const vendor = await inspect(vendorId);
      if (!vendor.models.some(model => model.type === "image" && model.modelName === modelId)) {
        return res.status(400).send({ code: 400, data: null, message: "请选择有效的图像模型" });
      }
    } catch {
      return res.status(400).send({ code: 400, data: null, message: "图像模型配置不可用" });
    }
    const changed = await work(db => db("o_project").where("id", projectId).update({ imageModel }));
    if (!changed) return res.status(404).send({ code: 404, data: null, message: "项目不存在" });
    return res.send(success({ imageModel }));
  });
  return router;
}

export default createSetImageModelRouter();
