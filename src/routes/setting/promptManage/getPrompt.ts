import express from "express";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

export default router.post("/", async (req, res) => {
  const data = await u.db("o_prompt").select("*");
  res.status(200).send(success(data));
});
