import { tool, jsonSchema, Tool } from "ai";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";
import u from "@/utils";

import { getDatabaseRuntime } from "@/database";
import {
  derivedChangeInstructionSchema,
  isChangeKindCompatibleWithBriefType,
  saveDerivedChangeInstruction,
  type DerivedChangeInstruction,
} from "@/assets/derivedChangeInstruction";
import { canonicalAssetBriefType } from "@/assets/assetBriefContract";
import { deleteDerivedAssetRecord } from "@/assets/derivedAssetDeletion";

/** 变化契约写入失败时抛出以中断事务并回滚资产写入（有资产必有契约）。 */
class ChangeInstructionWriteError extends Error {}
const deriveAssetSchema = z.object({
  id: z.number().describe("衍生资产ID,如果新增则为空"),
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
const storyboardSchema = z.object({
  id: z.number().describe("分镜ID，必须为真实id"),
  duration: z.number().describe("持续时长(秒)"),
  prompt: z.string().describe("生成提示词"),
  associateAssetsIds: z.array(z.number()).describe("关联资产ID列表"),
  src: z.string().nullable().describe("分镜资源路径"),
  index: z.number().nullable().optional().describe("分镜排序字段"),
});
const workbenchDataSchema = z.object({
  name: z.string().describe("项目名称"),
  duration: z.string().describe("视频时长"),
  resolution: z.string().describe("分辨率"),
  fps: z.string().describe("帧率"),
  cover: z.string().optional().describe("封面图片路径"),
  gradient: z.string().optional().describe("渐变色配置"),
});
const posterItemSchema = z.object({
  id: z.number().describe("海报ID"),
  image: z.string().describe("海报图片路径"),
});
export const flowDataSchema = z.object({
  script: z.string().describe("剧本内容"),
  scriptPlan: z.string().describe("拍摄计划"),
  assets: z.array(assetItemSchema).describe("衍生资产"),
  storyboardTable: z.string().describe("分镜表"),
  storyboard: z.array(storyboardSchema).describe("分镜面板"),
});

export type FlowData = z.infer<typeof flowDataSchema>;

const keySchema = z.enum(Object.keys(flowDataSchema.shape) as [keyof FlowData, ...Array<keyof FlowData>]);
const flowDataKeyLabels = Object.fromEntries(
  Object.entries(flowDataSchema.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof FlowData, string>;

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}

/**
 * 串行队列：确保 socket 操作排队执行，避免并发过高导致假死
 * @param delayMs 每个操作之间的最小间隔(ms)
 */
function createSocketQueue(delayMs = 800) {
  let lastPromise: Promise<any> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    lastPromise = lastPromise.then(
      () =>
        new Promise<T>((resolve, reject) => {
          setTimeout(() => fn().then(resolve, reject), delayMs);
        }),
    );
    return lastPromise;
  };
}

export default (toolCpnfig: ToolConfig) => {
  const { resTool, toolsNames, msg } = toolCpnfig;
  const { socket } = resTool;
  const socketQueue = createSocketQueue(800);
  const workMap: Record<any, any> = {};
  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取工作区数据",
      inputSchema: jsonSchema<{ key: keyof FlowData }>(
        z
          .object({
            key: keySchema.describe("数据key"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ key }) => {
        const thinking = msg.thinking(`正在获取${flowDataKeyLabels[key]}工作区数据...`);

        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key }, (res: any) => resolve(res)));
        thinking.appendText(`获取到${flowDataKeyLabels[key]}:\n` + JSON.stringify(flowData[key], null, 2));
        thinking.updateTitle(`获取${flowDataKeyLabels[key]}完成`);
        thinking.complete();
        if (workMap[key] && JSON.stringify(workMap[key]) === JSON.stringify(flowData[key])) {
          console.info(`[tools] get_flowData: ${flowDataKeyLabels[key]}数据未变化，无需更新`);
          return `${flowDataKeyLabels[key]}数据未变化，无需更新`;
        }
        workMap[key] = flowData[key];
        return flowData[key];
      },
    }),
    add_deriveAsset: tool({
      description: "新增或更新衍生资产（同时写入带版本的变化契约）",
      inputSchema: jsonSchema<{
        assetsId: number;
        id: number | null;
        name: string;
        desc: string;
        changeInstruction: DerivedChangeInstruction;
      }>(
        z
          .object({
            assetsId: z.number().describe("关联的资产ID"),
            id: z.number().nullable().describe("衍生资产ID,如果新增则为空"),
            name: z.string().describe("衍生资产名称"),
            desc: z.string().describe("衍生资产描述"),
            changeInstruction: derivedChangeInstructionSchema.describe(
              "变化契约：changeKind 与变化一致；preserve 至少一条；change 至少一条；exclude 可为空数组",
            ),
          })
          .toJSONSchema(),
      ),
      execute: async (raw) => {
        // 容错：LLM 偶尔传 "null" 字符串或空串，统一规范为 null
        const idRaw = raw.id as unknown;
        const normalizedId = idRaw === "null" || idRaw === "" || idRaw === undefined ? null : (idRaw as number | null);
        const deriveAsset = { ...raw, id: normalizedId };

        const thinking = msg.thinking("正在操作资产...");
        const { projectId, scriptId } = resTool.data;
        const startTime = Date.now();
        const parentAssets = await getDatabaseRuntime().work((db) =>
          db("o_assets").where({ id: deriveAsset.assetsId, projectId }).select("id", "type").first(),
        );
        if (!parentAssets) return "关联的资产不存在";
        const briefType = canonicalAssetBriefType(parentAssets.type);
        if (!briefType) {
          return `关联资产类型不受支持（${parentAssets.type ?? "未设置"}），无法写入衍生资产`;
        }
        const existingDerivedAsset =
          deriveAsset.id === null
            ? null
            : await getDatabaseRuntime().work((db) =>
                db("o_assets")
                  .where({
                    id: deriveAsset.id,
                    projectId,
                    assetsId: deriveAsset.assetsId,
                    type: parentAssets.type,
                  })
                  .select("id")
                  .first(),
              );
        if (briefType === "prop" && !existingDerivedAsset) {
          return "道具资产本阶段不主动衍生；仅可更新属于当前项目且挂在指定父资产下的既有衍生道具（legacy_prop_state）";
        }
        if (deriveAsset.id !== null && !existingDerivedAsset) {
          return "仅可更新属于当前项目且挂在指定父资产下的既有衍生资产";
        }

        // 变化契约在外部写入前校验：name/desc 只是展示字段，不构成可执行契约
        const parsedInstruction = derivedChangeInstructionSchema.safeParse(deriveAsset.changeInstruction);
        if (!parsedInstruction.success) {
          const issue = parsedInstruction.error.issues[0];
          return `变化契约不合法（${issue?.path?.join(".") ?? ""} ${issue?.message ?? "结构错误"}），请按 changeKind/evidence/preserve/change/exclude 结构重新提交`;
        }
        if (!isChangeKindCompatibleWithBriefType(parsedInstruction.data.changeKind, briefType)) {
          return `变化类型 ${parsedInstruction.data.changeKind} 与父资产类型 ${briefType} 不一致，请修正 changeKind 后重试`;
        }

        const data = {
          id: deriveAsset.id ?? undefined,
          assetsId: deriveAsset.assetsId,
          projectId,
          name: deriveAsset.name,
          type: parentAssets.type,
          describe: deriveAsset.desc,
          startTime,
        };
        // 资产与变化契约同事务写入：契约失败时抛错回滚，不留下“有资产无契约”的部分成功状态
        const contract = await getDatabaseRuntime()
          .work((db) =>
            db.transaction(async (tx) => {
              if (deriveAsset.id !== null) {
                const updated = await tx("o_assets")
                  .where({
                    id: deriveAsset.id,
                    projectId,
                    assetsId: deriveAsset.assetsId,
                    type: parentAssets.type,
                  })
                  .update(data);
                if (!updated) throw new ChangeInstructionWriteError("目标衍生资产已变化，请刷新后重试");
                thinking.appendText(`已更新衍生资产，ID: ${deriveAsset.id}\n`);
              } else {
                const [insertedId] = await tx("o_assets").insert(data);
                data.id = insertedId;
                await tx("o_scriptAssets").insert({ scriptId, assetId: insertedId });
                thinking.appendText(`已新增衍生资产，ID: ${insertedId}\n`);
              }
              // 变化契约与衍生资产一起落库（agent 来源、带版本），图片生成阶段确定性编译
              const saved = await saveDerivedChangeInstruction(async (operation) => operation(tx), {
                projectId,
                assetsId: data.id!,
                instruction: parsedInstruction.data,
                source: "agent",
                expectedBriefType: briefType,
              });
              if (!saved.ok) throw new ChangeInstructionWriteError(saved.message);
              return saved;
            }),
        )
          .catch((error: unknown) => {
            if (error instanceof ChangeInstructionWriteError) {
              return { ok: false as const, kind: "derivedChangeInstructionInvalid" as const, message: error.message };
            }
            throw error;
          });
        if (!contract.ok) {
          thinking.appendText(`变化契约写入失败：${contract.message}\n`);
          thinking.updateTitle("变化契约写入失败");
          thinking.complete();
          return `变化契约写入失败：${contract.message}`;
        }
        thinking.appendText(`已写入变化契约，revision: ${contract.value.revision}\n`);

        const res = await new Promise((resolve) => socket.emit("addDeriveAsset", data, (res: any) => resolve(res)));
        thinking.updateTitle("资产操作完成");
        thinking.complete();
        return res ?? "操作成功";
      },
    }),
    del_deriveAsset: tool({
      description: "删除衍生资产",
      inputSchema: jsonSchema<{ assetsId: number; id: number }>(
        z
          .object({
            assetsId: z.number().describe("关联的资产ID"),
            id: z.number().describe("衍生资产ID"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ assetsId, id }) => {
        const thinking = msg.thinking("正在操作资产...");
        const { projectId } = resTool.data;
        const deleted = await deleteDerivedAssetRecord(getDatabaseRuntime().work, {
          projectId,
          id,
          expectedParentAssetId: assetsId,
        });
        if (!deleted.ok) return deleted.message;
        thinking.appendText(`已删除衍生资产，ID: ${id}\n`);
        const res = await new Promise((resolve) => socket.emit("delDeriveAsset", { assetsId, id }, (res: any) => resolve(res)));
        thinking.updateTitle("资产操作完成");
        thinking.complete();
        return res ?? "删除成功";
      },
    }),
    generate_deriveAsset: tool({
      description: "生成衍生资产图片",
      inputSchema: jsonSchema<{ ids: number[] }>(
        z
          .object({
            ids: z.array(z.number()).describe("需要生成的 衍生资产ID"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ ids }) => {
        const thinking = msg.thinking("正在生成衍生资产...");
        new Promise((resolve) => socket.emit("generateDeriveAsset", { ids }, (res: any) => resolve(res)))
          .then((res) => {
            thinking.appendText(`已生成衍生资产，ID: ${JSON.stringify(res, null, 2)}\n`);
            thinking.updateTitle("衍生资产开始完成");
            thinking.complete();
          })
          .catch((e) => {
            thinking.appendText("衍生资产生成失败:\n" + u.error(e).message);
            thinking.updateTitle("衍生资产生成失败");
            thinking.complete();
          });

        return "开始生成衍生资产";
      },
    }),
    generate_storyboard: tool({
      description: "生成分镜图片",
      inputSchema: jsonSchema<{ ids: number[] }>(
        z
          .object({
            ids: z.array(z.number()).describe("必须获取真实的分镜ID，支持批量生成"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ ids }) => {
        const thinking = msg.thinking("正在生成分镜...");
        socketQueue(
          () =>
            new Promise((resolve, reject) =>
              socket.emit("generateStoryboard", { ids }, (res: any) => {
                if (res?.error) return reject(new Error(res.error));
                resolve(res);
              }),
            ),
        )
          .then((res) => {
            thinking.appendText("生成的分镜数据:\n" + JSON.stringify(res, null, 2));
            thinking.updateTitle("分镜生成完成");
            thinking.complete();
          })
          .catch((e) => {
            thinking.appendText("分镜生成失败:\n" + u.error(e).message);
            thinking.updateTitle("分镜生成失败");
            thinking.complete();
          });

        return "开始生成分镜";
      },
    }),
    add_flowData_storyboard: tool({
      description: "新增分镜面板到工作区",
      inputSchema: jsonSchema<{
        videoDesc: string;
        prompt: string | null;
        track: string;
        duration: number;
        associateAssetsIds: number[] | null;
        shouldGenerateImage: string;
      }>(
        z
          .object({
            videoDesc: z.string().describe("画面描述、场景、关联资产名称、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效、关联资产ID"),
            prompt: z.string().nullable().describe("分镜图片提示词"),
            track: z.string().describe("分组"),
            duration: z.number().describe("视频推荐时间"),
            associateAssetsIds: z.array(z.number()).nullable().describe("该分镜所需的资产ID列表"),
            shouldGenerateImage: z.enum(["true", "false"]).describe("是否需要生成分镜图片"),
          })
          .toJSONSchema(),
      ),
      execute: async (raw) => {
        const thinking = msg.thinking("正在新增 分镜面板 数据...");
        const data = {
          videoDesc: raw.videoDesc,
          prompt: raw.prompt,
          track: raw.track,
          duration: raw.duration,
          associateAssetsIds: raw.associateAssetsIds ?? [],
          shouldGenerateImage: raw.shouldGenerateImage,
        };
        socketQueue(
          () =>
            new Promise((resolve, reject) =>
              socket.emit("addStoryboard", { ...data }, (res: any) => {
                if (res?.error) return reject(new Error(res.error));
                resolve(res);
              }),
            ),
        )
          .then((res) => {
            thinking.appendText("新增的分镜数据:\n" + JSON.stringify(data, null, 2));
            thinking.updateTitle("新增分镜成功");
            thinking.complete();
          })
          .catch((e) => {
            thinking.appendText("新增的分镜数据:\n" + JSON.stringify(data, null, 2));
            thinking.updateTitle("新增分镜失败");
            thinking.complete();
          });
        return true;
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
