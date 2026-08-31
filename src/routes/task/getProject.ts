import express from "express";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const list = await getDatabaseRuntime().work(async (db) => {
    return await db("o_project").select("id", "name").groupBy("name");
  });
  const data = list.filter((item) => item.name);
  res.status(200).send(success(data));
});
