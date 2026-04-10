import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const data = await u.db("o_vendorConfig").select("*");

  const list = await Promise.all(
    data.map(async (item) => ({
      ...item,
      inputValues: JSON.parse(item.inputValues ?? "{}"),
      models: await u.vendor.getModelList(item.id!),
      code: u.vendor.getCode(item.id!),
      description: u.vendor.getVendor(item.id!).description,
      inputs: u.vendor.getVendor(item.id!).inputs,
      author: u.vendor.getVendor(item.id!).author,
      name: u.vendor.getVendor(item.id!).name,
    })),
  );

  res.status(200).send(success(list));
});
