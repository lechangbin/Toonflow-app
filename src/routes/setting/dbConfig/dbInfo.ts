import express from "express";
import { success, error } from "@/lib/responseFormat";
import { getDatabaseRuntime } from "@/database";

const router = express.Router();

export default router.get("/", async (req, res) => {
  try {
    const tableInfo = await getDatabaseRuntime().work(async (db) => {
      const tables: { name: string }[] = await db.raw(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'`,
      );

      const info = [];
      for (const table of tables) {
        const countResult = await db.raw(`SELECT COUNT(*) as count FROM "${table.name}"`);
        info.push({
          name: table.name,
          rowCount: countResult[0]?.count ?? 0,
        });
      }
      return info;
    });

    res.status(200).send(success(tableInfo));
  } catch (err: any) {
    res.status(500).send(error(err?.message || "获取数据库信息失败"));
  }
});
