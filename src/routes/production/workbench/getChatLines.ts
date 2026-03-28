import express from "express";
import u from "@/utils";
import { z } from "zod";
import { useSkill } from "@/utils/agent/skillsTools";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output } from "ai";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    list: z.array(
      z.object({
        prompt: z.string(),
        videoId: z.number(),
      }),
    ),
  }),
  async (req, res) => {
    const { list } = req.body;
    const data = await Promise.all(
      list.map(async (item: any) => {
        const output = await getLines(item.prompt);
        return { ...item, prompt: output };
      }),
    );
    res.status(200).send(success(data));
  },
);

async function getLines(prompt: string) {
  const skill = await useSkill("universal_agent.md");//todo：改为AI

  const resText = await u.Ai.Text("universalAi").invoke({
    system: skill.prompt,
    messages: [{ role: "user", content: prompt }],
    tools: skill.tools,
    output: Output.array({
      element: z.object({
        lines: z.string().describe("台词内容"),
      }),
    }),
  });
  console.log("%c Line:36 🍉 resText", "background:#e41a6a", resText);

  const parseLines = JSON.parse(resText.text);
  const chatLines = parseLines.elements.map((i: any) => i.lines);
  return chatLines;
}
