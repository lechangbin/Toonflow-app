import { ChatOpenAI, ChatOpenAIFields } from "@langchain/openai";

export const openAI = (config: ChatOpenAIFields = {}) => {
  return new ChatOpenAI({
    modelName: "gpt-4.1",
    temperature: 1,
    configuration: {
      apiKey: process.env.AI_OPENAI_KEY,
      baseURL: process.env.AI_OPENAI_URL,
    },
    ...config,
  });
};

export const doubao = (config: ChatOpenAIFields = {}) => {
  return new ChatOpenAI({
    model: "doubao-seed-1-6-flash-250828",
    temperature: 1,
    configuration: {
      apiKey: process.env.AI_TIKTOK_KEY,
      baseURL: process.env.AI_TIKTOK_URL,
    },
    ...config,
  });
};

export const deepseek = (config: ChatOpenAIFields = {}) =>
  new ChatOpenAI({
    model: "DeepSeek-V3.2",
    temperature: 1,
    configuration: {
      apiKey: process.env.AI_DEEPSEEK_KEY,
      baseURL: process.env.AI_DEEPSEEK_URL,
    },
    ...config,
  });
