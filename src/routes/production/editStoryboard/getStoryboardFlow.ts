import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    const storyboardFlowData = await u.db("o_storyboardFlow").where("stroryboardId", id).first();
    if (storyboardFlowData?.flowData) {
      const parseFlow = JSON.parse(storyboardFlowData.flowData);
      await Promise.all(
        parseFlow.nodes.map(async (node: any) => {
          if (node.type === "upload") {
            node.data.image = node.data.image ? await u.oss.getFileUrl(node.data.image) : "";
          } else if (node.type === "generated") {
            node.data.generatedImage = node.data.generatedImage ? await u.oss.getFileUrl(node.data.generatedImage) : "";
          }
        }),
      );
      return res.status(200).send(success(parseFlow));
    }

    return res.status(200).send(success(null));
  },
);
