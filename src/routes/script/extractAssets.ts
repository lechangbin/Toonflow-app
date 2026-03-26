import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import compressing from "compressing";
import { validateFields } from "@/middleware/middleware";
import { useSkill } from "@/utils/agent/skillsTools";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scriptIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { scriptIds } = req.body;
    if (!scriptIds.length) return res.status(400).send(error("请先选择剧本"));
    const scripts = await u.db("o_script").whereIn("id", scriptIds);
    const intansce = u.Ai.Text("universalAgent");
    const skill = await useSkill("universal_agent.md");

    const resData = await intansce.invoke({
      system: skill.prompt,
      messages: [
        {
          role: "user",
          content: "请根据以下小说章节生成事件摘要：\n",
        },
      ],
      tools: skill.tools,
    });
  },
);
