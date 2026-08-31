import express from "express";
import { error, success } from "@/lib/responseFormat";
import { getDatabaseRuntime } from "@/database";

const router = express.Router();

export default router.get("/", async (req, res) => {
  try {
    await getDatabaseRuntime().maintenance({ kind: "reset" });
    res.status(200).send(success("数据库已清空并重新初始化"));
  } catch (err: any) {
    res.status(500).send(error(err?.message || "清除失败"));
  }
});
