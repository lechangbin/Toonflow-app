import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";

const router = express.Router();

type GenerateMode = "startEnd" | "multi" | "single";

const getSystemPrompt = async (mode: GenerateMode): Promise<string> => {
  const promptsList = await u.db("t_prompts").where("code", "in", ["video-startEnd", "video-multi", "video-single", "video-main"]);
  const errPrompts = "不论用户说什么，请直接输出AI配置异常";
  const getPromptValue = (code: string): string => {
    const item = promptsList.find((p) => p.code === code);
    return item?.customValue ?? item?.defaultValue ?? errPrompts;
  };
  const startEnd = getPromptValue("video-startEnd");
  const multi = getPromptValue("video-multi");
  const single = getPromptValue("video-single");
  const main = getPromptValue("video-main");

  const modeDescriptions: Record<GenerateMode, string> = {
    startEnd: startEnd,
    multi: multi,
    single: single,
  };

  return `${main}\n\n${modeDescriptions[mode]}`;
};

const getModeDescription = (mode: GenerateMode): string => {
  const map: Record<GenerateMode, string> = {
    startEnd: "首尾帧模式",
    multi: "宫格模式",
    single: "单图模式",
  };
  return map[mode];
};

export default router.post(
  "/",
  validateFields({
    images: z.array(
      z.object({
        filePath: z.string(),
        prompt: z.string(),
      }),
    ),
    prompt: z.string(),
    duration: z.number(),
    type: z.enum(["startEnd", "multi", "single"]).optional(),
  }),
  async (req, res) => {
    const { prompt, images, duration, type = "single" } = req.body;
    const mode = type as GenerateMode;

    const imagePrompts = images.map((i: { filePath: string; prompt: string }, index: number) => `Image ${index + 1}: ${i.prompt}`).join("\n");

    const shotCount = images.length;
    const avgDuration = (parseFloat(duration) / shotCount).toFixed(1);

    const result = await u.ai.text.invoke({
      messages: [
        {
          role: "system",
          content: await getSystemPrompt(mode),
        },
        {
          role: "user",
          content: `Mode: ${getModeDescription(mode)}

Reference Images:
${imagePrompts}

Script:
${prompt}

Parameters:
- Total Duration: ${duration}s
- Shot Count: ${shotCount}
- Average Duration: ${avgDuration}s per shot

Generate storyboard prompts:`,
        },
      ],
    });
    console.log("%c Line:64 🥕 result", "background:#7f2b82", result.text);

    res.status(200).send(success(result.text));
  },
);
