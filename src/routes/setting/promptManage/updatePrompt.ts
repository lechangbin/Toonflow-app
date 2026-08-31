import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id, data } = req.body;
    await getDatabaseRuntime().work((db) => db("o_prompt").where("id", id).update({ useData: data }));
    res.status(200).send(success(123));
  },
);
