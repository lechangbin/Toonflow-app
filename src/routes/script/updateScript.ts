import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 编辑剧本
export default router.post(
    "/",
    validateFields({
        id: z.number(),
        name: z.string(),
        content: z.string(),
    }),
    async (req, res) => {
        const { id, name, content } = req.body;
        await u.db("o_script").where({ id }).update({
            name,
            content,
        });
        res.status(200).send(success({ message: "编辑剧本成功" }));
    },
);
