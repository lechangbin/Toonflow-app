import { EventEmitter } from "events";
import { o_novel } from "@/types/database";
import { useSkill } from "@/utils/agent/skillsTools";
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
    const intansce = u.Ai.Text("universalAgent");

    try {
      for (let gi = 0; gi < allChapters.length; gi++) {
        const novel = allChapters[gi];
        let resData;
        try {
          const skill = await useSkill("universal_agent.md");

          resData = await intansce.invoke({
            system: skill.prompt,
            messages: [
              {
                role: "user",
                content: "请根据以下小说章节生成事件摘要：\n" + novel.chapterData!,
              },
            ],
            tools: skill.tools,
          });
          console.log("%c Line:35 🍆 resData", "background:#fca650", resData);

          const preData = resData.text;

          this.emitter.emit("item", { id: novel.id, event: preData });
          totalEvent.push({ id: novel.id!, event: preData });
        } catch (e) {
          console.log("%c Line:51 🍩 e", "background:#93c0a4", e);
          this.emitter.emit("item", { id: novel.id, event: null, errorReason: u.error(e).message });
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
