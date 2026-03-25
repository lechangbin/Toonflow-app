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
    id: z.number().nullable().optional(),
    type: z.enum(["role", "scene", "storyboard", "clip", "tool"]),
  }),
  async (req, res) => {
    const { edges, nodes, imageUrl, id, type } = req.body;
    let imagePath = "";
    try {
      imagePath = new URL(imageUrl).pathname;
    } catch (e) {}
    nodes.forEach((node: any) => {
      if (node.type == "upload") {
        try {
          node.data.image = new URL(node.data.image).pathname;
        } catch (e) {
          node.data.image = "";
        }
      }
      if (node.type == "generated") {
        try {
          node.data.generatedImage = new URL(node.data.generatedImage).pathname;
        } catch (e) {
          node.data.generatedImage = "";
        }
      }
    });
    let insertFlowId;
    if (imagePath) {
      if (id) {
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

        insertFlowId = id;
      } else {
        const [storyboardId] = await u.db("o_storyboard").insert({
          filePath: imagePath,
          createTime: Date.now(),
        });
        insertFlowId = storyboardId;
      }
    }

    await u.db("o_imageFlow").insert({
      flowData: JSON.stringify({ edges, nodes }),
      ...(type == "assets" ? { assetsId: insertFlowId } : { storyboardId: insertFlowId }),
    });
    return res.status(200).send(success());
  },
);
