import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { number, z } from "zod";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    state: z.string().optional().nullable(),
    taskClass: z.string().optional().nullable(),
    page: z.number(),
    limit: z.number(),
  }),
  async (req, res) => {
    const { taskClass, state, page = 1, limit = 10 }: any = req.body;
    const offset = (page - 1) * limit;
    const data = await u
      .db("o_myTasks")
      .leftJoin("o_project", "o_project.id", "o_myTasks.projectId")
      .andWhere((qb) => {
        if (taskClass) {
          qb.andWhere("o_myTasks.taskClass", taskClass);
        }
        if (state) {
          qb.andWhere("o_myTasks.state", state);
        }
      })
      .select("o_myTasks.*", "o_project.* ")
      .offset(offset)
      .limit(limit);
    const totalQuery = (await u
      .db("o_myTasks")
      .andWhere((qb) => {
        if (taskClass) {
          qb.andWhere("o_myTasks.taskClass", taskClass);
        }
        if (state) {
          qb.andWhere("o_myTasks.state", state);
        }
      })
      .count("* as total")
      .first()) as any;
    res.status(200).send(success({ data, total: totalQuery?.total }));
  },
);
