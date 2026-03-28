import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import fs from "fs";
import path from "path";

const router = express.Router();

export default router.post("/", validateFields({}), async (req, res) => {
  res.status(200).send(success({}));
});
