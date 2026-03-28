import express from "express";
const router = express.Router();
import u from "@/utils";
import fs from "fs";
import { useSkill } from "@/utils/agent/skillsTools";

export default router.get("/", async (req, res) => {
  const skill = await useSkill(
    {
      mainSkill: "production_agent_execution",
      workspace: ["production_agent_skills/execution"],
      attachedSkills: ["art_prompts/chinese_sweet_romance/driector_skills"],
    },
  );

  const test = await u.Ai.Text("scriptAgent").invoke({
    system: skill.prompt,
    messages: [
      { role: "user", content: "渐进式激活skill，技能->资源1->资源2...一直渐进到最深处，并输出你的阅读路线，同级目录你只用读取一个无需全部读取" },
    ],
    tools: skill.tools,
  });

  console.log("%c Line:21 🌽 text", "background:#ea7e5c", test.text);
  res.send(test.text);
});
