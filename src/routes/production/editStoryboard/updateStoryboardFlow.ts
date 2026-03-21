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
    imageUrl: z.number(),
  }),
  async (req, res) => {
    const { edges, nodes, id, imageUrl } = req.body;
    if (!imageUrl.includes("http")) {
      return res.status(400).send({ message: "图片地址不合法" });
    }
    // if
    await u
      .db("o_storyboard")
      .where("id", id)
      .update({ filePath: new URL(imageUrl).pathname });
    await u
      .db("o_storyboardFlow")
      .where("stroryboardId", id)
      .update({
        flowData: JSON.stringify({ edges, nodes }),
      });
    return res.status(200).send(success());
  },
);
