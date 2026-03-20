import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const { type } = req.body;
  const vendorData = await u.db("o_vendorConfig").select("id", "models", "name");
  if (!vendorData) {
    return res.status(404).send({ error: "模型未找到" });
  }
  for (const item of vendorData) {
    const modelsData = JSON.parse(item.models! ?? "[]");
    const filterData = modelsData.filter((item: { type: string }) => item.type === type);
    if (filterData.length > 0) {
    }
  }
});
