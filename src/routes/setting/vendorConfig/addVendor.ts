import express from "express";
import { serializeError } from "serialize-error";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { transform } from "sucrase";
const router = express.Router();

const vendorConfigSchema = z.object({
  version: z.number(),
  icon: z.string().optional(),
  name: z.string(),
  inputs: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(["text", "password", "url"]),
      required: z.boolean(),
      placeholder: z.string().optional(),
    }),
  ),
  inputValues: z.record(z.string(), z.string()),
  models: z.array(
    z.discriminatedUnion("type", [
      z.object({
        name: z.string(),
        modelName: z.string(),
        type: z.literal("text"),
        multimodal: z.boolean(),
        tool: z.boolean(),
      }),
      z.object({
        name: z.string(),
        modelName: z.string(),
        type: z.literal("image"),
        mode: z.array(z.enum(["text", "singleImage", "multiReference"])),
      }),
      z.object({
        name: z.string(),
        modelName: z.string(),
        type: z.literal("video"),
        mode: z.array(
          z.enum([
            "singleImage",
            "multiImage",
            "gridImage",
            "startEndRequired",
            "endFrameOptional",
            "startFrameOptional",
            "text",
            "audioReference",
            "videoReference",
          ]),
        ),
        audio: z.union([z.literal("optional"), z.boolean()]),
        durationResolutionMap: z.array(
          z.object({
            duration: z.array(z.number()),
            resolution: z.array(z.string()),
          }),
        ),
      }),
    ]),
  ),
});

export default router.post(
  "/",
  validateFields({
    tsCode: z.string(),
  }),
  async (req, res) => {
    try {
      const { tsCode } = req.body;
      const jsCode = transform(tsCode, { transforms: ["typescript"] }).code;
      const exports = u.vm(jsCode);
      if (!exports) return res.status(400).send(success("脚本文件必须导出对象"));
      if (!exports.textRequest) return res.status(400).send(success("脚本文件必须导出文本请求对象"));
      if (!exports.imageRequest) return res.status(400).send(success("脚本文件必须导出图像请求对象"));
      if (!exports.videoRequest) return res.status(400).send(success("脚本文件必须导出视频请求对象"));
      if (!exports.vendor) return res.status(400).send(success("脚本文件必须导出vendor对象"));
      const vendor = exports.vendor;
      const result = vendorConfigSchema.safeParse(vendor);
      if (!result.success) {
        const errorMsg = result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
        return res.status(400).send(error(`vendor配置校验失败: ${errorMsg}`));
      }
      await u.db("o_vendorConfig").insert({
        name: vendor.name,
        version: vendor.version.toString(),
        icon: vendor.icon || "",
        inputs: JSON.stringify(vendor.inputs),
        inputValues: JSON.stringify(vendor.inputValues),
        models: JSON.stringify(vendor.models),
        code: tsCode,
        createTime: Date.now(),
      });
      res.status(200).send(success(result.data));
    } catch (err) {
      console.log(err);
      res.status(400).send(error(serializeError(err).message || "未知错误"));
    }
  },
);
