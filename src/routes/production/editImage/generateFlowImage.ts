import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import axios from "axios";
import { getDefaultConfiguredVendor } from "@/vendor";
import { parseVendorModelName } from "@/vendor";
import { applyLegacyImageReferenceConversion, normalizeHttpResult } from "@/utils/imageGeneration";
const router = express.Router();

async function urlToBase64(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("/oss/")) {
    return await u.oss.getImageBase64(u.replaceUrl(imageUrl).replace("/smallImage", ""));
  }
  imageUrl = await u.oss.getFileUrl(u.replaceUrl(imageUrl));
  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const contentType = response.headers["content-type"] || "image/png";
  const base64 = Buffer.from(response.data, "binary").toString("base64");
  return `data:${contentType};base64,${base64}`;
}
export default router.post(
  "/",
  validateFields({
    model: z.string(),
    references: z.array(z.string()).optional(),
    quality: z.string(),
    ratio: z.string(),
    prompt: z.string(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { model, references = [], quality, ratio, prompt, projectId } = req.body;
    try {
      const { vendorId, modelId } = parseVendorModelName(model);
      const taskRecord = await u.task(projectId, "工作流图片生成", modelId, {
        describe: "工作流图片生成",
        content: JSON.stringify(req.body),
      });
      let result: string;
      try {
        const vendor = getDefaultConfiguredVendor();
        const { version } = await vendor.inspectVendor(vendorId);
        const input = applyLegacyImageReferenceConversion(version, {
          prompt: prompt,
          referenceList: await (async () => {
            const list: { type: "image"; base64: string }[] = [];
            for (const url of references) {
              list.push({ type: "image" as const, base64: await urlToBase64(url) });
            }
            return list;
          })(),
          size: quality,
          aspectRatio: ratio,
        });
        result = await vendor.generateImage({ target: { vendorId, modelId }, input });
        result = await normalizeHttpResult(result);
      } catch (e) {
        taskRecord(-1, u.error(e).message);
        throw new Error(u.error(e).message);
      }
      taskRecord(1);
      const savePath = `${projectId}/workFlow/${u.uuid()}.jpg`;
      await u.oss.writeFile(savePath, result);

      const url = await u.oss.getSmallImageUrl(savePath);
      return res.status(200).send(success({ url }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
