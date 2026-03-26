import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import compressing from "compressing";
import { validateFields } from "@/middleware/middleware";
import { useSkill } from "@/utils/agent/skillsTools";
import { Output, tool } from "ai";

const router = express.Router();
export const AssetSchema = z.object({
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("资产名称,仅为名称不做其他任何表述"),
  desc: z.string().describe("资产描述"),
  type: z.enum(["role", "tool", "scene"]).describe("资产类型"),
});
export default router.post(
  "/",
  validateFields({
    scriptIds: z.array(z.number()),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { scriptIds, projectId } = req.body;
    if (!scriptIds.length) return res.status(400).send(error("请先选择剧本"));
    const scripts = await u.db("o_script").whereIn("id", scriptIds);
    const intansce = u.Ai.Text("universalAgent");
    const novelData = await u.db("o_novel").where("projectId", projectId).select("chapterData");
    if (!novelData || novelData.length === 0) return res.status(400).send(error("请先上传小说"));

    async function getAssets() {
      return await u.db("o_assets").where("projectId", projectId).select("id", "name");
    }
    for (const scriptId of scriptIds) {
      const resultTool = tool({
        description: "返回结果时必须调用这个工具,",
        inputSchema: z.object({
          assetsList: z.array(AssetSchema).describe("剧本所使用资产列表,注意不要包含剧本内容,仅为所使用到的 道具、人物、场景、素材"),
        }),
        execute: async ({ assetsList }) => {
          console.log("[tools] set_flowData script", assetsList);
          if (assetsList && assetsList.length) {
            const assetId = [];
            const existingAssets = await getAssets();
            for (const i of assetsList) {
              if (existingAssets.length) {
                const exist = existingAssets.find((j) => j.name === i.name);
                if (exist) {
                  assetId.push(exist.id);
                  continue;
                }
              }
              const [id] = await u.db("o_assets").insert({
                name: i.name,
                prompt: i.prompt,
                type: i.type,
                describe: i.desc,
                projectId: projectId,
                startTime: Date.now(),
              });
              assetId.push(id);
            }

            await u.db("o_scriptAssets").insert(assetId.map((i) => ({ scriptId: scriptId, assetId: i })));
          }
          return true;
        },
      });
      try {
        const skill = await useSkill("universal_agent.md");
        const resData = await intansce.invoke({
          messages: [
            {
              role: "system",
              content:
                skill.prompt +
                "\n\n提取剧本中涉及的资产（角色、场景、道具），参考技能 script_assets_extract 规范，结果必须通过 resultTool 工具返回。",
            },
            {
              role: "user",
              content: `请根据以下剧本提取对应的剧本资产（角色、场景、道具、素材片段）:\n\n${scripts.map((i) => i.content).join("\n\n---\n\n")}`,
            },
          ],
          tools: { ...skill.tools, resultTool },
        });
        console.log("%c Line:47 🥝 resData", "background:#2eafb0", resData);
      } catch (e) {
        console.log("%c Line:52 🍢 e", "background:#42b983", e);
      }
    }
  },
);
