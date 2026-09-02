import express from "express";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { removeAssetPromptRecordRows } from "@/assets/assetPromptOrchestration";
import { removeDerivedChangeInstructionRows } from "@/assets/derivedChangeInstruction";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { id, projectId } = req.body;
    const assetsFirstData = await getDatabaseRuntime().work((db) => db("o_assets").where("id", id).first());
    if (!assetsFirstData) {
      return res.status(404).send({ error: "资源未找到" });
    }
    if (assetsFirstData?.flowId) {
      await getDatabaseRuntime().work((db) => db("o_imageFlow").where("id", assetsFirstData?.flowId).delete());
    }
    // 单一事务：变化契约、提示词记录、资产与分镜关联要么一起删除，要么都不删除
    await getDatabaseRuntime().work((db) =>
      db.transaction(async (tx) => {
        await removeDerivedChangeInstructionRows(tx, [id]);
        await removeAssetPromptRecordRows(tx, [id]);
        await tx("o_assets").where("id", id).delete();
        await tx("o_assets2Storyboard").where("assetId", id).delete();
      }),
    );
    res.status(200).send(success({ message: "视频删除成功" }));
  },
);
