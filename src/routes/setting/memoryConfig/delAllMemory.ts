import express from "express";
import { error, success } from "@/lib/responseFormat";
import { getDatabaseRuntime } from "@/database";
const router = express.Router();

export default router.post("/", async (req, res) => {
  await getDatabaseRuntime().work((db) => db("memories").del());
  res.status(200).send(success(true));
});
