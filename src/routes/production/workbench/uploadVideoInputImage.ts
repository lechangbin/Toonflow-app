import express from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { uploadVideoInputImage } from "@/video/inputUpload";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    base64Data: z.string().min(1),
  }),
  async (req, res, next) => {
    try {
      const result = await uploadVideoInputImage(
        {
          db: u.db,
          createId: uuid,
          writeFile: (filePath, bytes) => u.oss.writeFile(filePath, bytes),
          getFileUrl: (filePath) => u.oss.getFileUrl(filePath),
        },
        req.body,
      );
      res.status(200).send(success(result));
    } catch (error) {
      next(error);
    }
  },
);
