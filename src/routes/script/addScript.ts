import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增剧本
export default router.post(
    "/",
    validateFields({
        name: z.string(),
        content: z.string(),
        projectId: z.number(),
    }),
    async (req, res) => {
        const { name, content, projectId } = req.body;
        await u.db("o_script").insert({
            name,
            content,
            projectId,
            createTime: Date.now(),
        });
        res.status(200).send(success({ message: "添加剧本成功" }));
    },
);
