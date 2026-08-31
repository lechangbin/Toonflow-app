import express from "express";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
const router = express.Router();

export default router.get("/", async (req, res) => {
  const data = await getDatabaseRuntime().work(async (db) => db("o_user").select("*").first());
  res.status(200).send(success(data));
});
