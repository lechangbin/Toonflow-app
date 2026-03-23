import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    edges: z.any(),
    nodes: z.any(),
    imageUrl: z.string(),
  }),
  async (req, res) => {
    const { edges, nodes, imageUrl } = req.body;
    if (!imageUrl.includes("http")) {
      return res.status(400).send({ message: "图片地址不合法" });
    }
    nodes.forEach((node: any) => {
      if (node.type == "upload") {
        node.data.image = node.data.image ? new URL(node.data.image).pathname : "";
      }
      if (node.type == "generated") {
        node.data.generatedImage = node.data.generatedImage ? new URL(node.data.generatedImage).pathname : "";
      }
    });
    const [id] = await u.db("o_storyboard").insert({
      filePath: new URL(imageUrl).pathname,
      createTime: Date.now(),
    });
    await u.db("o_storyboardFlow").insert({
      stroryboardId: id,
      flowData: JSON.stringify({ edges, nodes }),
    });
    return res.status(200).send(success());
  },
);
