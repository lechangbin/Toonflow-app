import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 删除剧本
export default router.post(
    "/",
    validateFields({
        id: z.number(),
    }),
    async (req, res) => {
        const { id } = req.body;
        await u.db("o_script").where({ id }).delete();
        res.status(200).send(success({ message: "删除剧本成功" }));
    },
);
