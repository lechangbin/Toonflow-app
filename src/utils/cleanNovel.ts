import * as z from "zod";
import { ModelMessage, Output } from "ai";
import { EventEmitter } from "events";

import { o_novel } from "@/types/database";
import ai from "@/utils/ai";
import u from "@/utils";
export interface EventType {
  id: number;
  event: string;
}

/*  文本数据清洗
 * @param textData 需要清洗的文本
 * @param windowSize 每组数量 默认5
 * @param overlap 交叠数量 默认1
 * @returns {totalCharacter:所有人物角色卡,totalEvent:所有事件}
 */

class CleanNovel {
  emitter: EventEmitter;
  constructor() {
    this.emitter = new EventEmitter();
  }
  async start(allChapters: o_novel[], projectId: number): Promise<EventType[]> {
    //所有事件
    let totalEvent: EventType[] = [];
    const intansce = u.Ai.Text("eventExtractAgent");

    try {
      for (let gi = 0; gi < allChapters.length; gi++) {
        const novel = allChapters[gi];
        let resData;
        try {
          resData = await intansce.invoke({
            messages: [
              {
                role: "system",
                content: `
你是一位专业的叙事结构分析师。
请阅读以下小说章节，用**一段话**提炼本章的情节单元摘要。
## 要求
- 按事件发生顺序，串联本章核心情节节点
- 突出人物行为、关键转折、因果关系
- 语言简洁紧凑，100-150字以内
- 不加主观评价，只陈述"发生了什么"
---
【章节内容】：
`,
              },
              {
                role: "user",
                content: novel.chapterData!,
              },
            ],
          });

          const preData = resData.text;

          this.emitter.emit("item", { id: novel.id, event: preData });
          totalEvent.push({ id: novel.id!, event: preData });
        } catch (e) {
          this.emitter.emit("item", { id: novel.id, event: null });
        }
      }
    } catch (e) {
      console.error(e);
      throw e;
    }
    return totalEvent;
  }
}

export default CleanNovel;
