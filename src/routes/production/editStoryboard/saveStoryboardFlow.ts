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
    imageId: z.number(),
  }),
  async (req, res) => {
    const { edges, nodes, imageId } = req.body;
    // if
    const [id] = await u.db("o_storyboad").insert({
      imageId,
    });
    await u.db("o_storyboardFlow").insert({
      id: 1,
      stroryboardId: id,
      flowData: JSON.stringify({ edges, nodes }),
    });
    return res.status(200).send(success());
  },
);
