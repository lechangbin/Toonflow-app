import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { id } from "zod/locales";
const router = express.Router();

export default router.post(
    "/",
    validateFields({
        paths: z.array(z.string())
    }),
    async (req, res) => {
        const { paths } = req.body;
        const result: Record<string, string> = {};
        await Promise.all(
            paths.map(async (path: string) => {
                result[path] = await u.oss.getFileUrl(path.replace(/^\/oss/, ''));
            }))

        res.status(200).send(success({ data: result }));
    },
);
