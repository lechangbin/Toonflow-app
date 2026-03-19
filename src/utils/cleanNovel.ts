import * as z from "zod";
import { ModelMessage, Output } from "ai";

import { o_novel } from "@/types/database";
import ai from "@/utils/ai";
import u from "@/utils";
export interface EventType {
  name: string;
  detail: string;
  chapter: string;
}

export interface Novel {
  event: EventType[];
}
// 章节拆分
function getChapterGroups<T>(chapters: T[], windowSize: number = 5, overlap: number = 1): T[][] {
  const res: T[][] = [];
  if (windowSize < 1 || overlap < 0) return res;
  let i = 0;
  const length = chapters.length;
  while (i < length) {
    if (res.length === 0) {
      // 第一组，直接取 windowSize 个
      res.push(chapters.slice(i, i + windowSize));
      i += windowSize;
    } else {
      // 取上一组最后 overlap 个，加上新的 windowSize 个
      const prevGroup = res[res.length - 1];
      const overlapItems = prevGroup.slice(-overlap);
      const newItems = chapters.slice(i, i + windowSize);
      if (newItems.length === 0) break; // 已经取完，跳出
      res.push([...overlapItems, ...newItems]);
      i += windowSize;
    }
  }
  return res;
}

/*  文本数据清洗
 * @param textData 需要清洗的文本
 * @param windowSize 每组数量 默认5
 * @param overlap 交叠数量 默认1
 * @returns {totalCharacter:所有人物角色卡,totalEvent:所有事件}
 */

class CleanNovel {
  windowSize: number;
  overlap: number;
  constructor(windowSize: number = 5, overlap: number = 1) {
    this.windowSize = windowSize;
    this.overlap = overlap;
  }
  async start(allChapters: o_novel[], projectId: number): Promise<EventType[]> {
    const groups = getChapterGroups(allChapters!, this.windowSize, this.overlap);

    let preData: Novel | null = null;
    //所有事件
    let totalEvent: EventType[] = [];
    const intansce = u.Ai.Text("eventExtractAi");

    try {
      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        // 第一批没有交叠章节，后续批次前 overlap 个是交叠章节（仅作上下文，不输出事件）
        const overlapCount = gi === 0 ? 0 : this.overlap;
        const overlapChapterIndexes = group.slice(0, overlapCount).map((i) => i.chapterIndex);

        const cleanText = group
          .map((i, index: number) => {
            const isOverlap = overlapChapterIndexes.includes(i.chapterIndex);
            return {
              role: "user",
              content: isOverlap
                ? `【上文衔接章节，仅供上下文参考，禁止为本章生成情节单元】\n第${i.chapterIndex}章：\n\n${i.chapterData}`
                : `第${i.chapterIndex}章：\n\n${i.chapterData}`,
            } as ModelMessage;
          })
          .filter(Boolean);
        const taskRecord = await u.task(projectId, "事件提取", "gpt-4.1", {
          describe: "根据小说原文，提取情节单元",
          content: cleanText,
        });
        let resData;
        try {
          resData = await intansce.invoke({
            messages: [
              {
                role: "system",
                content: `
你是专业剧本结构分析师，负责将用户提供的章节文本拆分为标准情节单元。请严格遵循以下规则执行。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【情节单元拆分规则】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▍拆分粒度
- 连续多个章节若属同一戏剧动作，可合并为 1 个情节单元，禁止过细拆分；
- 每个情节单元的 detail 字数控制在 100～200 字。

▍每个情节单元包含以下三个字段
- chapter：事件覆盖的章节范围（如"1-3章"），每个章节只能归属一个事件；
- name：事件名称，须具体描述实际戏剧动作，禁止使用"XXX踏上征程""命运转折"等笼统标题；
- detail：事件过程详情，包含时间、地点、涉及人物、起因、经过、结果。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【执行规则】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 必须执行
1. 所有章节按剧情顺序逐一覆盖，不得遗漏；
2. 标注为【上文衔接章节】的内容仅作上下文理解使用，禁止为其生成任何情节单元。

🚫 禁止出现
- 笼统事件名称；
- 单个章节拆分为多个情节单元；
- 遗漏任何章节。
`,
              },
              ...cleanText,
            ],
            output: Output.object({
              schema: z.object({
                event: z.array(
                  z
                    .object({
                      chapter: z
                        .string()
                        .describe(
                          "事件覆盖的章节（如1-3章、4-6章），章节划分必须连续，每个章节范围只能属于一个事件。事件分割不可过细——避免只描述琐碎、日常细节的微小事件。",
                        ),
                      name: z.string().describe("事件名称"),
                      detail: z.string().describe("事件过程详情（包括起因、经过、结果、场景、人物等）"),
                    })
                    .describe("事件必须在100-200字说明起因经过结果，不可将单一章节或细小场景独立成事件，"),
                ),
              }),
            }),
          });
        } catch (e) {
          taskRecord(-1, u.error(e).message);
          throw e;
        }
        taskRecord(1);

        preData = JSON.parse(resData.text);

        const newEvents = preData?.event || [];
        newEvents.forEach((newItem) => {
          totalEvent.push({ ...newItem });
        });
      }
    } catch (e) {
      console.error(e);
      throw e;
    }
    return totalEvent;
  }
}

export default CleanNovel;
