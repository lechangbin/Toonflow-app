import express from "express";
const router = express.Router();
import u from "@/utils";
import fs from "fs";
import { useSkill } from "@/utils/agent/skillsTools";

export default router.get("/", async (req, res) => {
  const skill = await useSkill("universal_agent.md");
    console.log("%c Line:11 🍏 skill.prompt", "background:#fca650", skill.prompt);
  const result = await u.Ai.Text("universalAgent").invoke({
    system: "请直接调用activate_skill工具激活技能" + skill.prompt,
    messages: [{ role: "user", content: `如何烹饪龙肉` }],
    tools: skill.tools,
  });

  res.send(result.text);
});
