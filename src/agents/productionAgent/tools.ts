import { tool, Tool } from "ai";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";
import u from "@/utils";
import { useSkill } from "@/utils/agent/skillsTools";
import { urlToBase64 } from "@/utils/vm";
export const deriveAssetSchema = z.object({
  id: z.number().describe("衍生资产ID,如果新增则为空").optional(),
  assetsId: z.number().describe("关联的资产ID"),
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("衍生资产名称"),
  desc: z.string().describe("衍生资产描述"),
  src: z.string().nullable().describe("衍生资产资源路径"),
  state: z.enum(["未生成", "生成中", "已完成", "生成失败"]).describe("衍生资产生成状态"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("衍生资产类型"),
});
export const assetItemSchema = z.object({
  id: z.number().describe("资产唯一标识"),
  name: z.string().describe("资产名称"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("资产类型"),
  prompt: z.string().describe("生成提示词"),
  desc: z.string().describe("资产描述"),
  derive: z.array(deriveAssetSchema).describe("衍生资产列表"),
});
export const storyboardSchema = z.object({
  id: z.number().optional().describe("分镜ID,未从工作区获得的分镜面板视为需要新增;如需新增则为空"),
  title: z.string().describe("分镜标题"),
  description: z.string().describe("分镜描述"),
  camera: z.string().describe("镜头信息"),
  duration: z.number().describe("持续时长(秒)"),
  frameMode: z.enum(["firstFrame", "endFrame", "linesSoundEffects"]).describe("帧模式: 首帧/尾帧/台词音效"),
  prompt: z.string().describe("生成提示词"),
  lines: z.string().nullable().describe("台词内容"),
  sound: z.string().nullable().describe("音效内容"),
  associateAssetsIds: z.array(z.number()).describe("关联资产ID列表"),
  src: z.string().nullable().describe("分镜资源路径"),
});
export const workbenchDataSchema = z.object({
  name: z.string().describe("项目名称"),
  duration: z.string().describe("视频时长"),
  resolution: z.string().describe("分辨率"),
  fps: z.string().describe("帧率"),
  cover: z.string().optional().describe("封面图片路径"),
  gradient: z.string().optional().describe("渐变色配置"),
});
export const posterItemSchema = z.object({
  id: z.number().describe("海报ID"),
  image: z.string().describe("海报图片路径"),
});
export const flowDataSchema = z.object({
  script: z.string().describe("剧本内容"),
  scriptPlan: z.string().describe("拍摄计划"),
  assets: z.array(assetItemSchema).describe("衍生资产"),
  storyboardTable: z.string().describe("分镜表"),
  storyboard: z.array(storyboardSchema).describe("分镜面板"),
  workbench: workbenchDataSchema.describe("工作台配置"),
  poster: z
    .object({
      items: z.array(posterItemSchema).describe("海报项目列表"),
    })
    .describe("海报配置"),
});

export type FlowData = z.infer<typeof flowDataSchema>;

const keySchema = z.enum(Object.keys(flowDataSchema.shape) as [keyof FlowData, ...Array<keyof FlowData>]);
const flowDataKeyLabels = Object.fromEntries(
  Object.entries(flowDataSchema.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof FlowData, string>;

export default (resTool: ResTool, toolsNames?: string[]) => {
  const { socket } = resTool;
  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取工作区数据",
      inputSchema: z.object({
        key: keySchema.describe("数据key"),
      }),
      execute: async ({ key }) => {
        resTool.systemMessage(`正在阅读 ${flowDataKeyLabels[key]} 数据...`);
        console.log("[tools] get_flowData", key);
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key }, (res: any) => resolve(res)));
        return flowData[key];
      },
    }),
    set_flowData_script: tool({
      description: "保存剧本内容到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.script }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData script", value);
        resTool.systemMessage("正在保存 剧本 数据");
        socket.emit("setFlowData", { key: "script", value });
        return true;
      },
    }),
    set_flowData_scriptPlan: tool({
      description: "保存拍摄计划到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.scriptPlan }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData scriptPlan", value);
        resTool.systemMessage("正在保存 拍摄计划 数据");
        socket.emit("setFlowData", { key: "scriptPlan", value });
        return true;
      },
    }),
    // add_flowData_assets: tool({
    //   description: "新增对应衍生资产列表到工作区，严禁包含 不需要新增的数据",
    //   inputSchema: z.object({ value: z.array(deriveAssetSchema).describe("需要新增的资产列表") }),
    //   execute: async ({ value }) => {
    //     console.log("[tools] set_flowData add_flowData_assets", value);
    //     resTool.systemMessage("正在保存 衍生资产 数据");
    //     const addAssetsData = [];
    //     if (value && Array.isArray(value) && value.length) {
    //       for (const i of value) {
    //         const [insertedId] = await u.db("o_assets").insert({
    //           assetsId: +i.assetsId || null,
    //           projectId: resTool.data.projectId,
    //           name: i.name,
    //           type: i.type,
    //           prompt: i.prompt,
    //           describe: i.desc,
    //           startTime: Date.now(),
    //         });
    //         console.log("%c Line:141 🍑 resTool.data.scriptId", "background:#ea7e5c", resTool.data.scriptId);
    //         await u.db("o_scriptAssets").insert({
    //           scriptId: resTool.data.scriptId,
    //           assetId: insertedId,
    //         });
    //         addAssetsData.push({
    //           ...i,
    //           id: insertedId,
    //         });
    //       }
    //     }
    //     socket.emit("setFlowData", { key: "addAssets", value: addAssetsData });
    //     return true;
    //   },
    // }),
    set_flowData_assets: tool({
      description: "保存衍生资产列表到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.assets }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData assets", value);
        resTool.systemMessage("正在保存 衍生资产 数据");
        if (value && Array.isArray(value) && value.length) {
          for (const i of value) {
            if (!i?.id) {
              const [insertedId] = await u.db("o_assets").insert({
                assetsId: null,
                name: i.name,
                type: i.type,
                prompt: i.prompt,
                describe: i.desc,
                startTime: Date.now(),
              });
              i.id = insertedId;
            }
            if (i.derive && Array.isArray(i.derive) && i.derive.length) {
              for (const sub of i.derive) {
                if (sub.id) continue;
                const [insertedId] = await u.db("o_assets").insert({
                  assetsId: +i.id || null,
                  projectId: resTool.data.projectId,
                  name: sub.name,
                  type: sub.type,
                  prompt: sub.prompt,
                  describe: sub.desc,
                  startTime: Date.now(),
                });
                await u.db("o_scriptAssets").insert({
                  scriptId: resTool.data.scriptId,
                  assetId: insertedId,
                });
                sub.id = insertedId;
              }
            }
          }
        }
        socket.emit("setFlowData", { key: "assets", value });
        return true;
      },
    }),
    set_flowData_storyboardTable: tool({
      description: "保存分镜表到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.storyboardTable }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData storyboardTable", value);
        resTool.systemMessage("正在保存 分镜表 数据...");
        socket.emit("setFlowData", { key: "storyboardTable", value });
        return true;
      },
    }),
    set_flowData_storyboard: tool({
      description: "保存分镜面板到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.storyboard }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData storyboard", value);
        resTool.systemMessage("正在保存 分镜面板 数据...");
        for (const item of value) {
          if (!item.id) {
            const [insertedId] = await u.db("o_storyboard").insert({
              title: item.title,
              prompt: item.prompt,
              description: item.description,
              filePath: item.src,
              frameMode: item.frameMode,
              duration: String(item.duration),
              camera: item.camera,
              sound: item.sound,
              lines: item.lines,
              state: "未生成",
              scriptId: resTool.data.scriptId,
            });
            if (item.associateAssetsIds.length) {
              await u.db("o_assets2Storyboard").insert(item.associateAssetsIds.map((i) => ({ storyboardId: insertedId, assetId: i })));
            }
            item.id = insertedId;
          }
        }
        socket.emit("setFlowData", { key: "storyboard", value });
        return true;
      },
    }),
    set_flowData_workbench: tool({
      description: "保存工作台配置数据到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.workbench }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData workbench", value);
        resTool.systemMessage("正在保存 工作台配置 数据...");
        socket.emit("setFlowData", { key: "workbench", value });
        return true;
      },
    }),
    set_flowData_poster: tool({
      description: "保存海报配置到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.poster }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData poster", value);
        resTool.systemMessage("正在保存 海报 数据...");
        socket.emit("setFlowData", { key: "poster", value });
        return true;
      },
    }),

    //todo referenceIds 图片未使用  提示词待调
    generate_storyboard_images: tool({
      description: `生成一组图片任务，支持图片间的依赖关系（以图生图）。

    参数说明：
    - images: 图片任务数组
      - id: 图片唯一标识符
      - prompt: 图片生成提示词
      - referenceIds: 依赖的参考图id数组，无依赖填空数组[]
      - assetIds: 参考的资产图id数组（可选）

    依赖规则：
    1. referenceIds中的id必须存在于images数组中
    2. 禁止循环依赖（如A依赖B，B依赖A）
    3. 被依赖的图片会先生成，其结果作为参考图传入

    示例：生成猫图，再以猫图为参考生成狗图
    images: [
      {id: "cat", prompt: "一只橘猫", referenceIds: [], assetIds: []},
      {id: "dog", prompt: "风格相同的金毛犬", referenceIds: ["cat"], assetIds: []}
    ]`,
      inputSchema: z.object({
        images: z.array(
          z.object({
            id: z.number().describe("从工作区获取到的分镜id"),
            prompt: z.string().describe("图片生成提示词"),
            referenceIds: z.array(z.string()).describe("依赖的参考图id数组，无依赖填空数组[]"),
            assetIds: z.array(z.number()).optional().describe("参考的资产图"),
          }),
        ),
      }),
      execute: async ({ images }) => {
        console.log("[tools] generated_assets", images);

        const skill = await useSkill("universal-agent");
        for (const item of images) {
          resTool.systemMessage(`生在生成分镜 id:${item.id} 图片`);
          //更新对应分镜状态
          await u.db("o_storyboard").where("id", item.id).update({ state: "生成中" });
          // 异步生成
          const imageModel = resTool.data.imageModel;

          u.Ai.Image(imageModel?.modelId)
            .run({
              systemPrompt: skill.prompt,
              prompt: item.prompt,
              imageBase64: await getAssetsImageBase64(item.assetIds ?? []),
              size: imageModel?.quality,
              aspectRatio: imageModel?.ratio,
              taskClass: "生成图片",
              describe: "分镜图片生成",
              relatedObjects: "hhhh",
              projectId: resTool.data.projectId,
            })
            .then(async (imageCls) => {
              const savePath = `/${resTool.data.projectId}/storyboard/${u.uuid()}.jpg`;
              await imageCls.save(savePath);
              const obj = {
                ...item,
                id: item.id,
                src: await u.oss.getFileUrl(savePath),
                state: "已完成",
              };
              // 更新对应分镜状态
              await u.db("o_storyboard").where("id", item.id).update({ state: "已完成", filePath: savePath });
              // 前端对话框提示
              resTool.systemMessage(`分镜 id:${item.id} 图片生成完成`);
              // 更新前端界面展示
              socket.emit("setFlowData", { key: "setStoryboardImage", value: obj });
            });
          //更新前端为生成中
          socket.emit("setFlowData", { key: "setStoryboardImage", value: { ...item, id: item.id, src: "", state: "生成中" } });
        }
        return "分镜图片生成中";
      },
    }),

    //todo 图片是否需要参考 原资产  提示词待调
    generate_assets_images: tool({
      description: `
      生成 资产图片 不区分原资产于衍生资产
      参数说明：
      - images: 图片任务数组
        - assetId: 资产id
        - prompt: 图片生成提示词
      示例：
      images:[
        {assetId: 1, prompt: "一张猫的图片"}
      ]
      `,
      inputSchema: z.object({ images: z.array(z.object({ assetId: z.number(), prompt: z.string() })) }),
      execute: async ({ images }) => {
        const skill = await useSkill("universal-agent");
        //获取所设置模型
        const imageModel = resTool.data.imageModel;
        for (const item of images) {
          const [imageId] = await u.db("o_image").insert({
            // 数据库插入图片记录
            assetsId: item.assetId,
            model: imageModel?.modelId,
            state: "生成中",
            resolution: imageModel?.quality,
          });
          u.Ai.Image(imageModel?.modelId)
            .run({
              systemPrompt: skill.prompt,
              prompt: item.prompt,
              imageBase64: [],
              size: imageModel?.quality,
              aspectRatio: imageModel?.ratio,
              taskClass: "生成图片",
              describe: "资产图片生成",
              relatedObjects: "hhhh",
              projectId: resTool.data.projectId,
            })
            .then(async (imageCls) => {
              const savePath = `/${resTool.data.projectId}/assets/${u.uuid()}.jpg`;
              await imageCls.save(savePath);
              const obj = {
                ...item,
                id: item.assetId,
                src: await u.oss.getFileUrl(savePath),
                state: "已完成",
              };
              //更新对应数据库
              await u.db("o_assets").where("id", item.assetId).update({ imageId: imageId });
              await u.db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath });
              //通知前端更新
              socket.emit("setFlowData", { key: "setAssetsImage", value: obj });
            });
          //通知前端更新状态
          socket.emit("setFlowData", { key: "setAssetsImage", value: { ...item, id: item.assetId, src: "", state: "生成中" } });
        }
        console.log("[tools] generate_assets_images", images);
        return "资产生成中";
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};

async function getAssetsImageBase64(imageIds: number[]) {
  if (imageIds.length === 0) return [];
  const imagePaths = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .whereIn("o_assets.id", imageIds)
    .select("o_assets.id", "o_image.filePath");
  if (!imagePaths.length) return [];
  const imageUrls = await Promise.all(
    imagePaths.map(async (i) => {
      if (i.filePath) {
        return await urlToBase64(await u.oss.getFileUrl(i.filePath));
      } else {
        return null;
      }
    }),
  );
  return imageUrls.filter(Boolean) as string[];
}
