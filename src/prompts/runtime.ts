import type { Knex } from "knex";

import { getDatabaseRuntime } from "@/database";

export const runtimePromptKeys = {
  eventExtraction: "eventExtraction",
  audioBind: "audioBindPrompt",
  memorySummary: "memorySummary",
  memoryRelevance: "memoryRelevance",
  artStyleExtraction: "artStyleExtraction",
  scriptRegex: "scriptRegex",
  scriptStorySkeletonFormat: "scriptStorySkeletonFormat",
  scriptAdaptationFormat: "scriptAdaptationFormat",
  scriptExecutionFormat: "scriptExecutionFormat",
  productionDirectorPlanFormat: "productionDirectorPlanFormat",
  productionStoryboardPanelFormat: "productionStoryboardPanelFormat",
  productionStoryboardTableFormat: "productionStoryboardTableFormat",
} as const;

export type RuntimePromptKey = (typeof runtimePromptKeys)[keyof typeof runtimePromptKeys];

interface RuntimePromptDefault {
  type: RuntimePromptKey;
  name: string;
  data: string;
}

const additionalDefaults: RuntimePromptDefault[] = [
  {
    type: runtimePromptKeys.memorySummary,
    name: "Agent 记忆压缩",
    data: "你是一个记忆压缩助手。请将以下多条记忆内容压缩为一段简洁的摘要，不超过{{summaryMaxLength}}个字符。只输出摘要内容，不要加任何前缀或解释。",
  },
  {
    type: runtimePromptKeys.memoryRelevance,
    name: "Agent 记忆相关性判断",
    data: '你是一个信息检索助手。用户会给你一个关键词和一组摘要，请判断哪些摘要可能包含与关键词相关的详细信息。只返回相关摘要的id列表，用JSON数组格式，例如 ["id1","id2"]。不要解释。',
  },
  {
    type: runtimePromptKeys.artStyleExtraction,
    name: "图片画风提取",
    data: '请根据以下图片数据，提取出图片的画风提示词，用于生成图片时指定风格，要求简洁且具有艺术性,只需要画风提示词，不需要其他内容："比如：`(画风：2D动漫风格,2d animation style)`,`(画风：照片级真人超写实,photorealistic, lifelike, ultra detailed)`，`(画风：3D国创,Chinese 3D animation style)`等,如果图片风格无法描述，可以返回`无法描述`,多张图片时，只输出一个综合的画风提示词，要求包含所有图片的共同风格特征，输出格式必须严格按照示例中的格式，必须包含`画风`二字，且必须使用括号括起来，括号内必须包含中文和英文的画风描述，并用逗号分隔，英文部分需要翻译成地道的英文提示词',
  },
  {
    type: runtimePromptKeys.scriptRegex,
    name: "剧本章节正则识别",
    data: `你是一个正则表达式专家。用户会提供一段剧本文本，你需要分析其中的集/章节分隔模式，返回一个JavaScript正则表达式字符串。

要求：
1. 正则必须包含两个捕获组：第一个捕获组匹配集数/章节编号（数字或中文数字），第二个捕获组匹配该集的标题/名称（scriptName）。
2. 返回格式为 /正则表达式/g，例如：/第\\s*([0-9一二三四五六七八九十百千万]+)\\s*集\\s*([^\\n\\r]*)/g
3. 只返回正则表达式字符串本身，不要有任何其他解释文字或 Markdown 格式。
4. 如果文本中没有明显的章节分隔模式，返回空字符串。`,
  },
  {
    type: runtimePromptKeys.scriptStorySkeletonFormat,
    name: "编剧 Agent · 故事骨架输出格式",
    data: "你必须使用如下XML格式写入工作区：\n<storySkeleton>故事骨架内容</storySkeleton>",
  },
  {
    type: runtimePromptKeys.scriptAdaptationFormat,
    name: "编剧 Agent · 改编策略输出格式",
    data: "你必须使用如下XML格式写入工作区：\n<adaptationStrategy>改编策略内容</adaptationStrategy>",
  },
  {
    type: runtimePromptKeys.scriptExecutionFormat,
    name: "编剧 Agent · 剧本输出格式",
    data: '你必须使用如下XML格式写入工作区：\nXML不得添加任何额外标签<scriptItem name="剧本名称">剧本内容</scriptItem><scriptItem name="剧本名称">剧本内容</scriptItem><scriptItem name="剧本名称">剧本内容</scriptItem>',
  },
  {
    type: runtimePromptKeys.productionDirectorPlanFormat,
    name: "视频制作 Agent · 导演规划输出格式",
    data: "你必须使用如下XML格式写入工作区：\n```\n<scriptPlan>内容</scriptPlan>\n```",
  },
  {
    type: runtimePromptKeys.productionStoryboardPanelFormat,
    name: "视频制作 Agent · 分镜面板输出格式",
    data: "你必须使用如下XML格式写入工作区：\n```\n<storyboardItem videoDesc='视频描述' prompt=提示词内容 track='分组' shouldGenerateImage='true/false' duration='视频推荐时间' associateAssetsIds='[该分镜所需的资产ID列表]'></storyboardItem>\n```",
  },
  {
    type: runtimePromptKeys.productionStoryboardTableFormat,
    name: "视频制作 Agent · 分镜表输出格式",
    data: "你必须使用如下XML格式写入工作区：\n```\n<storyboardTable>内容</storyboardTable>\n```",
  },
];

export async function ensureRuntimePromptDefaults(database: Knex): Promise<void> {
  if (!(await database.schema.hasTable("o_prompt"))) return;
  for (const prompt of additionalDefaults) {
    const current = await database("o_prompt").where("type", prompt.type).first();
    if (current) {
      await database("o_prompt").where("type", prompt.type).update({ name: prompt.name, data: prompt.data });
    } else {
      await database("o_prompt").insert(prompt);
    }
  }
}

export async function getRuntimePrompt(
  type: RuntimePromptKey,
  variables: Record<string, string | number> = {},
): Promise<string> {
  const row = await getDatabaseRuntime().work((database) => database("o_prompt").where("type", type).first());
  if (!row) throw new Error(`运行时提示词不存在：${type}`);
  const source = (row.useData || row.data || "").trim();
  if (!source) throw new Error(`运行时提示词为空：${type}`);
  return source.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match: string, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match,
  );
}
