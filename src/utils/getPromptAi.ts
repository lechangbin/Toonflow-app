import { db } from "./db";
interface AiConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  manufacturer: string;
  promptsId: number;
}

export default async function getPromptAi(promptsId: number | undefined): Promise<AiConfig | {}>;
export default async function getPromptAi(promptsId: number[]): Promise<AiConfig[]>;

export default async function getPromptAi(promptsId: number | number[] | undefined): Promise<AiConfig | AiConfig[] | {}> {
  if (!promptsId) return {};
  const ids = Array.isArray(promptsId) ? promptsId.filter(Boolean) : [promptsId];
  const mapList = await db("t_aiModelMap")
    .leftJoin("t_config", "t_config.id", "t_aiModelMap.configId")
    .whereIn("t_aiModelMap.promptsId", ids)
    .select("t_config.model", "t_config.apiKey", "t_config.baseUrl", "t_config.manufacturer", "t_aiModelMap.promptsId");

  if (Array.isArray(promptsId)) {
    return mapList as AiConfig[];
  } else {
    return mapList[0] ? (mapList[0] as AiConfig) : {};
  }
}
