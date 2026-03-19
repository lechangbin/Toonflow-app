import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
    "/",
    validateFields({
        projectId: z.number(),
        name: z.string().optional(),
    }),
    async (req, res) => {
        const { projectId, name } = req.body;
        let query = u.db("o_script").where("projectId", projectId).select("*");
        if (name) {
            query = query.andWhere("name", "like", `%${name}%`);
        }
        const data = await query;
        res.status(200).send(success(data));
    },
);
