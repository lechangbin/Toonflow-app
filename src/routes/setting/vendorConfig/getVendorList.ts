import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const data = await u.db("o_vendorConfig").select("*");

  const list = data.map((item) => ({
    ...item,
    inputs: JSON.parse(item.inputs ?? "{}"),
    inputValues: JSON.parse(item.inputValues ?? "{}"),
    models: JSON.parse(item.models ?? "[]"),
  }));
  res.status(200).send(success(list));
});
