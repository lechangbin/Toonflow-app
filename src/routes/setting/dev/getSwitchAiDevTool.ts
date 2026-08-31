import express from "express";
import { success, error } from "@/lib/responseFormat";
import { getDatabaseRuntime } from "@/database";

const router = express.Router();

export default router.get("/", async (req, res) => {
    const switchAiDevTool = await getDatabaseRuntime().work((db) => db("o_setting").where("key", "switchAiDevTool").first());
    res.status(200).send(success(switchAiDevTool?.value || "0"));
});
