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
    imageId: z.number(),
  }),
  async (req, res) => {
    const { edges, nodes, id, imageId } = req.body;
    // if
    await u.db("o_storyboard").where("id", id).update({ imageId });
    await u
      .db("o_storyboardFlow")
      .where("stroryboardId", id)
      .update({
        flowData: JSON.stringify({ edges, nodes }),
      });
    return res.status(200).send(success());
  },
);
