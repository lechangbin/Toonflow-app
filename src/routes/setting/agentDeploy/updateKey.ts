import express from "express";
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
export default router.post("/",
    validateFields({
        id: z.number(),
        key: z.string(),
    }),
    async (req, res) => {
        const { id, key } = req.body;
        const data = await u.db("o_vendorConfig").where("id", id).select("code", "inputValues").first();
        let inputValues = JSON.parse(data?.inputValues || "{}");
        inputValues.apiKey = key;
        const jsCode = transform(data?.code!, { transforms: ["typescript"] }).code;
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
        const replaceBlockValue = (code: string, key: string, newValue: string): string => {
            const open = newValue.trimStart()[0] as "[" | "{";
            const close = open === "[" ? "]" : "}";
            const keyMatch = code.match(new RegExp(`\\b${key}\\s*:\\s*[\\[{]`));
            if (!keyMatch || keyMatch.index === undefined) return code;
            const valueStart = keyMatch.index + keyMatch[0].length - 1;
            let depth = 0;
            let valueEnd = -1;
            for (let i = valueStart; i < code.length; i++) {
                if (code[i] === open) depth++;
                else if (code[i] === close) {
                    depth--;
                    if (depth === 0) {
                        valueEnd = i;
                        break;
                    }
                }
            }
            if (valueEnd === -1) return code;
            return code.slice(0, valueStart) + newValue + code.slice(valueEnd + 1);
        };
        let updatedTsCode = data?.code!;
        updatedTsCode = replaceBlockValue(updatedTsCode, "inputValues", JSON.stringify(inputValues ?? vendor.inputValues, null, 2));
        await u.db("o_vendorConfig").where("id", id).update({
            inputValues: inputValues ? JSON.stringify(inputValues) : JSON.stringify(vendor.inputValues),
            code: updatedTsCode,
        });
        res.status(200).send(success("保存成功"));
    });
