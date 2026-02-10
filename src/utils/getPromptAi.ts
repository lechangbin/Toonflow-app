import { db } from "./db";
interface AiConfig {
  model?: string;
  apiKey: string;
  baseURL?: string;
  manufacturer: string;
}

export default async function getPromptAi(key: string): Promise<AiConfig | {}> {
  const aiConfigData = await db("t_aiModelMap")
    .leftJoin("t_config", "t_config.id", "t_aiModelMap.configId")
    .where("t_aiModelMap.key", key)
    .select("t_config.model", "t_config.apiKey", "t_config.baseUrl as baseURL", "t_config.manufacturer")
    .first();

  if (aiConfigData) {
    return aiConfigData as AiConfig;
  } else return {};
}
