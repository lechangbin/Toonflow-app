import express from "express";
import { error, success } from "@/lib/responseFormat";
import { getDatabaseRuntime } from "@/database";
const router = express.Router();

// 清空数据表
export default router.post("/", async (req, res) => {
  try {
    await getDatabaseRuntime().maintenance({ kind: "reset" });
    res.status(200).send(success({ message: "清空数据表成功" }));
  } catch (err: any) {
    res.status(500).send(error(err?.message || "清空数据表失败"));
  }
});
