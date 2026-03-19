import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 获取生产数据
export default router.post(
    "/",
    validateFields({
        projectId: z.number(),
    }),
    async (req, res) => {
        const { projectId } = req.body;
        res.status(200).send(success("123"));
    }
);
