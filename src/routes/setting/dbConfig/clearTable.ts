import express from "express";
import { error, success } from "@/lib/responseFormat";
import { getDatabaseRuntime, MaintenanceValidationError } from "@/database";

const router = express.Router();

export default router.post("/", async (req, res) => {
  try {
    const result = await getDatabaseRuntime().maintenance({ kind: "clearTable", tableName: req.body?.tableName });
    res.status(200).send(success(`表 ${result.clearedTable} 已清空`));
  } catch (err: any) {
    if (err instanceof MaintenanceValidationError) {
      return res.status(400).send(error(err.message));
    }
    res.status(500).send(error(err?.message || "清空表失败"));
  }
});
