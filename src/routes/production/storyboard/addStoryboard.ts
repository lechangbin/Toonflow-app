import express from "express";
import u from "@/utils";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { getDefaultConfiguredVendor } from "@/vendor";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { createVideoTrack } from "@/video/trackCreation";
const router = express.Router();
interface Storyboard {
  id: number;
  track: string;
  src: string | null;
  associateAssetsIds: number[];
  duration: number;
  state: string;
}
export default router.post(
  "/",
  validateFields({
    prompt: z.string(),
    duration: z.number(),
    state: z.string(),
    videoDesc: z.string(),
    shouldGenerateImage: z.number(),
    src: z.string().nullable(),
    scriptId: z.number(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { prompt, duration, state, src, scriptId, projectId, videoDesc, shouldGenerateImage } = req.body;
    const trackId = Date.now();
    await createVideoTrack(
      {
        db: (operation) => getDatabaseRuntime().work(operation),
        getVendorModels: (vendorId) =>
          getDefaultConfiguredVendor().inspectVendor(vendorId).then((inspection) => inspection.models),
      },
      { id: trackId, projectId, scriptId, duration },
    );
    const [id] = await getDatabaseRuntime().work((db) =>
      db("o_storyboard").insert({
        prompt,
        duration,
        state,
        filePath: u.replaceUrl(src),
        trackId,
        videoDesc,
        shouldGenerateImage: src ? 1 : 0,
        scriptId: scriptId,
        projectId: projectId,
      }),
    );
    return res.status(200).send(success({ id }));
  },
);
