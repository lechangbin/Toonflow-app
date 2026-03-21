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
    console.log("%c Line:15 🥤 id", "background:#e41a6a", id);
    const storyboardFlowData = await u.db("o_storyboardFlow").where("stroryboardId", id).first();
    if (storyboardFlowData?.flowData) {
      return res.status(200).send(success(JSON.parse(storyboardFlowData?.flowData)));
    }
    return res.status(200).send(
      success({
        nodes: [],
        edges: [],
      }),
    );
  },
);
