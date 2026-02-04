import "../type";
import axios from "axios";
import u from "@/utils";

interface DoubaoVideoConfig {
  prompt: string;
  savePath: string;
  imageBase64?: string[]; // 单张参考图片 base64
  duration: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12; // 支持 2~12 秒
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive";
  audio?: boolean;
}

const pollTask = async (
  queryFn: () => Promise<{ completed: boolean; imageUrl?: string; error?: string }>,
  maxAttempts = 500,
  interval = 2000,
): Promise<string> => {
  for (let i = 0; i < maxAttempts; i++) {
    await  new Promise((resolve) => setTimeout(resolve, interval));
    const { completed, imageUrl, error } = await queryFn();
    if (error) throw new Error(error);
    if (completed && imageUrl) return imageUrl;
  }
  throw new Error(`任务轮询超时，已尝试 ${maxAttempts} 次`);
};

export default async (input: ImageConfig, config: AIConfig) => {
  console.log("%c Line:5 🍓 input", "background:#7f2b82", input);
  console.log("%c Line:5 🍎 config", "background:#93c0a4", config);
  if (!config.model) throw new Error("缺少Model名称");
  if (!config.apiKey) throw new Error("缺少API Key");

  const key = "Bearer " + config.apiKey.replaceAll("Bearer ", "").trim();

  const doubaoConfig = config as DoubaoVideoConfig;
  const createRes = await axios.post(
    config.baseURL ?? "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
    {
      model: "doubao-seedance-1-5-pro-251215",
      content: [
        { type: "text", text: input.prompt },
        ...(doubaoConfig.imageBase64
          ? doubaoConfig.imageBase64.map((base64, i) => ({
              type: "image_url",
              image_url: { url: base64 },
              role: i === 0 ? "first_frame" : "last_frame",
            }))
          : []),
      ],
      generate_audio: doubaoConfig.audio ?? false,
      duration: doubaoConfig.duration,
      resolution: doubaoConfig.aspectRatio,
      watermark: false,
    },
    { headers: { "Content-Type": "application/json", Authorization: key } },
  );
  const taskId = createRes.data.id;
  if (!taskId) throw new Error("视频任务创建失败");
  return await pollTask(async () => {
    const res = await axios.get(`${config.baseURL ?? "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"}/${taskId}`, {
      headers: { Authorization: key },
    });
    const { status, content } = res.data;
    if (status === "succeeded") return { completed: true, imageUrl: content?.video_url };
    if (["failed", "cancelled", "expired"].includes(status)) return { completed: false, error: `任务${status}` };
    if (["queued", "running"].includes(status)) return { completed: false };
    return { completed: false, error: `未知状态: ${status}` };
  });
};
