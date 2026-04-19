import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 获取生成图片
export default router.post(
    "/",
    validateFields({
        url: z.string()
    }),
    async (req, res) => {
        const { url } = req.body
        const bigImageUrl = await u.oss.getFileUrl(u.replaceUrl(url))
        res.status(200).send(success(bigImageUrl));
    },
);
