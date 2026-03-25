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
    id: z.number(),
    imageUrl: z.string(),
    type: z.enum(["role", "scene", "storyboard", "clip", "tool"]),
    flowId: z.number(),
  }),
  async (req, res) => {
    const { edges, nodes, id, imageUrl, flowId, type } = req.body;
    nodes.forEach((node: any) => {
      if (node.type == "upload") {
        node.data.image = node.data.image ? new URL(node.data.image).pathname : "";
      }
      if (node.type == "generated") {
        node.data.generatedImage = node.data.generatedImage ? new URL(node.data.generatedImage).pathname : "";
      }
    });
    let imagePath = "";
    try {
      imagePath = new URL(imageUrl).pathname;
    } catch (e) {}
    if (imagePath) {
      console.log("%c Line:34 🍰", "background:#33a5ff");
      if (type == "storyboard") {
        await u.db("o_storyboard").where("id", id).update({
          filePath: imagePath,
        });
      } else {
        const [imageId] = await u.db("o_image").insert({
          filePath: imagePath,
          assetsId: id,
          state: "已完成",
        });
        await u.db("o_assets").where("id", id).update({ imageId });
      }
    }

    await u
      .db("o_imageFlow")
      .where("id", flowId)
      .update({
        flowData: JSON.stringify({ edges, nodes }),
      });
    return res.status(200).send(success());
  },
);
