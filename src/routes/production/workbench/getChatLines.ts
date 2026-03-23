import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output } from "ai";
const router = express.Router();

export default router.post("/", validateFields({}), async (req, res) => {
  const {} = req.body;
});

async function getLines() {
  const resText = await u.Ai.Text("eventExtractAgent").invoke({
    messages: [
      {
        role: "system",
        content: `
你是一个专业的文本分析助手，请从以下文本中提取所有台词（对话内容）。
## 提取规则：
1. 提取所有人物说话的内容，包括：
   - 引号内的对话（"..."、'...'、「...」、『...』）
   - 旁白式独白
2. 忽略说话者、叙述性文字、动作描写
3. 保留台词的原始语气和标点
4. 忽略非对话的叙述性文字
5. 直接以 JSON 数组格式输出，不要任何额外说明
示例输出格式：
["台词1", "台词2", "台词3"]
            `,
      },
      {
        role: "user",
        content: `
          
          `,
      },
    ],
    output: Output.array({
      element: z.object({
        lines: z.string().describe("台词内容"),
      }),
    }),
  });
  const parseLines = JSON.parse(resText.text);
  const chatLines = parseLines.elements.map((i) => i.lines);
  return chatLines;
}
