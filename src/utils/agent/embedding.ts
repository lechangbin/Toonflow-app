import { pipeline, env as transformersEnv, FeatureExtractionPipeline } from "@huggingface/transformers";
import path from "path";
import fs from "fs";

const modelDir = path.join(
  typeof process.versions?.electron !== "undefined" ? require("electron").app.getPath("userData") : process.cwd(),
  "data",
  "models",
  "all-MiniLM-L6-v2",
);

let extractor: FeatureExtractionPipeline | null = null;

export async function initEmbedding(): Promise<void> {
  if (extractor) return;

  const requiredFiles = ["config.json", "tokenizer.json", "onnx/model.onnx"];
  for (const file of requiredFiles) {
    const filePath = path.join(modelDir, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
  }

  transformersEnv.allowRemoteModels = false;
  transformersEnv.allowLocalModels = true;
  transformersEnv.localModelPath = path.dirname(modelDir).replace(/\\/g, "/") + "/";

  // @ts-ignore
  extractor = await pipeline("feature-extraction", path.basename(modelDir), { dtype: "fp32" });
}

export async function getEmbedding(text: string): Promise<number[]> {
  if (!extractor) await initEmbedding();
  const output = await extractor!(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  return a.reduce((dot, v, i) => dot + v * b[i], 0);
}

export async function disposeEmbedding(): Promise<void> {
  await extractor?.dispose?.();
  extractor = null;
}
