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
    imageUrl: z.number(),
  }),
  async (req, res) => {
    const { edges, nodes, imageUrl } = req.body;
    if (!imageUrl.includes("http")) {
      return res.status(400).send({ message: "图片地址不合法" });
    }
    // if
    const [id] = await u.db("o_storyboad").insert({
      filePath: new URL(imageUrl).pathname,
    });
    await u.db("o_storyboardFlow").insert({
      stroryboardId: id,
      flowData: JSON.stringify({ edges, nodes }),
    });
    return res.status(200).send(success());
  },
);
