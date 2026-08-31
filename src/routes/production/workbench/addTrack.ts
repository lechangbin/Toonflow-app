import express from "express";
import u from "@/utils";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { getDefaultConfiguredVendor } from "@/vendor";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { createVideoTrack } from "@/video/trackCreation";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    duration: z.number().optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, duration } = req.body;
    const track = await createVideoTrack(
      {
        db: (operation) => getDatabaseRuntime().work(operation),
        getVendorModels: (vendorId) =>
          getDefaultConfiguredVendor().inspectVendor(vendorId).then((inspection) => inspection.models),
      },
      { id: Date.now(), projectId, scriptId, duration },
    );
    res.status(200).send(success(track.id));
  },
);
