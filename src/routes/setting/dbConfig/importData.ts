import express from "express";
import { error, success } from "@/lib/responseFormat";
import { getDatabaseRuntime, MaintenanceValidationError } from "@/database";

const router = express.Router();

export default router.post("/", async (req, res) => {
  try {
    await getDatabaseRuntime().maintenance({ kind: "import", tables: req.body?.tables });
    res.status(200).send(success("数据库导入成功"));
  } catch (err: any) {
    if (err instanceof MaintenanceValidationError) {
      return res.status(400).send(error(err.message));
    }
    res.status(500).send(error(err?.message || "导入失败"));
  }
});
