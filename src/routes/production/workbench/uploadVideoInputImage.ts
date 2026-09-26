import express from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";

import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { uploadVideoInputImage } from "@/video/inputUpload";
import { assertWorkbenchProjectOwner, WorkbenchOwnerRejectedError,
  type WorkbenchOwnerCheck } from "@/video/workbenchOwner";

export function createUploadVideoInputImageRouter(
  authorize: WorkbenchOwnerCheck = assertWorkbenchProjectOwner,
  upload: typeof uploadVideoInputImage = uploadVideoInputImage,
) {
  const router = express.Router();
  return router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    base64Data: z.string().min(1),
  }),
  async (req, res, next) => {
    try {
      await authorize(req, req.body.projectId);
      const result = await upload(
        {
          db: (operation) => getDatabaseRuntime().work(operation),
          createId: uuid,
          writeFile: (filePath, bytes) => u.oss.writeFile(filePath, bytes),
          getFileUrl: (filePath) => u.oss.getFileUrl(filePath),
        },
        req.body,
      );
      res.status(200).send(success(result));
    } catch (error) {
      if (error instanceof WorkbenchOwnerRejectedError) {
        res.status(403).send({ message: error.message });
        return;
      }
      next(error);
    }
  },
);
}

export default createUploadVideoInputImageRouter();
