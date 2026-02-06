import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

// 生成视频
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    configId: z.number().optional(), // 关联的视频配置ID
    type: z.string().optional(),
    resolution: z.string(),
    filePath: z.array(z.string()),
    duration: z.number(),
    prompt: z.string(),
  }),
  async (req, res) => {
    const { type, scriptId, projectId, configId, resolution, filePath, duration, prompt } = req.body;

    // 参数校验
    if (type === "volcengine") {
      if (duration < 4 || duration > 12) {
        return res.status(400).send(error("视频时长需在4-12秒之间"));
      }
      if (!["480p", "720p", "1080p"].includes(resolution)) {
        return res.status(400).send(error("视频分辨率不正确"));
      }
    }

    if (type === "runninghub") {
      if (duration !== 10 && duration !== 15) {
        return res.status(400).send(error("视频时长只能是10秒或15秒"));
      }
      if (resolution !== "9:16" && resolution !== "16:9") {
        return res.status(400).send(error("视频分辨率不正确"));
      }
    }

    // 过滤掉空值
    let fileUrl = filePath.filter((p: string) => p && p.trim() !== "");

    if (fileUrl.length === 0) {
      return res.status(400).send(error("请至少选择一张图片"));
    }

    // 处理文件路径，如果是 base64 则上传到 OSS
    if (fileUrl.length === 1) {
      const match = fileUrl[0].match(/base64,([A-Za-z0-9+/=]+)/);
      if (match && match.length >= 2) {
        const imagePath = `/${projectId}/assets/${uuidv4()}.jpg`;
        const buffer = Buffer.from(match[1], "base64");
        await u.oss.writeFile(imagePath, buffer);
        fileUrl = [await u.oss.getFileUrl(imagePath)];
      }
    }

    // 提取路径名的辅助函数
    const getPathname = (url: string): string => {
      // 如果是完整 URL，提取 pathname
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return new URL(url).pathname;
      }
      // 否则认为已经是路径
      return url;
    };

    // 校验文件是否存在
    const fileExistsResults = await Promise.all(
      fileUrl.map(async (url: string) => {
        const path = getPathname(url);
        return u.oss.fileExists(path);
      }),
    );

    if (!fileExistsResults.every(Boolean)) {
      return res.status(400).send(error("选择分镜文件不存在"));
    }

    const firstFrame = getPathname(fileUrl[0]);
    const storyboardImgs = fileUrl.map((path: string) => getPathname(path));
    const savePath = `/${projectId}/video/${uuidv4()}.mp4`;

    // 先插入记录，state 默认为 0
    const [videoId] = await u.db("t_video").insert({
      scriptId,
      configId: configId || null, // 关联的视频配置ID
      time: duration,
      resolution,
      prompt,
      firstFrame,
      storyboardImgs: JSON.stringify(storyboardImgs),
      filePath: savePath,
      state: 0,
    });

    // 立即返回，不等待视频生成
    res.status(200).send(success({ id: videoId, configId: configId || null }));

    // 异步生成视频
    generateVideoAsync(videoId, projectId, fileUrl, savePath, prompt, duration, resolution, type);
  },
);

// 异步生成视频
async function generateVideoAsync(
  videoId: number,
  projectId: number,
  fileUrl: string[],
  savePath: string,
  prompt: string,
  duration: number,
  resolution: string,
  type?: string,
) {
  try {
    const projectData = await u.db("t_project").where("id", projectId).select("artStyle").first();

    // 提取路径名的辅助函数
    const getPathname = (url: string): string => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return new URL(url).pathname;
      }
      return url;
    };

    const imageBase64 = await Promise.all(
      fileUrl.map((path: string) => {
        if (path.startsWith("http://") || path.startsWith("https://")) {
          return u.oss.getImageBase64(getPathname(path));
        }
        // 如果是相对路径，直接获取
        return u.oss.getImageBase64(path);
      }),
    );

    const inputPrompt = `
请完全参照以下内容生成视频：
${prompt}
重要强调：
风格高度保持${projectData?.artStyle || "CG"}风格，保证人物一致性
1. 视频整体风格、色调、光影、人脸五官与参考图片保持高度一致
2. 保证视频连贯性、前后无矛盾
3. 关键人物在画面中全部清晰显示，不得被遮挡、缺失或省略
4. 画面真实、细致，无畸形、无模糊、无杂物、无多余人物、无文字、水印、logo
`;
    const videoPath = await u.ai.video({
      imageBase64,
      savePath,
      prompt: inputPrompt,
      duration: duration as any,
      aspectRatio: resolution as any,
      resolution: resolution as any,
    });

    if (videoPath) {
      // 生成成功，更新状态为 1
      await u.db("t_video").where("id", videoId).update({
        filePath: videoPath,
        state: 1,
      });
    } else {
      // 生成失败，更新状态为 -1
      await u.db("t_video").where("id", videoId).update({ state: -1 });
    }
  } catch (err) {
    console.error(`视频生成失败 videoId=${videoId}:`, err);
    await u.db("t_video").where("id", videoId).update({ state: -1 });
  }
}
