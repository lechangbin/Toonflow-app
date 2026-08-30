import { jsonSchema } from "ai";
import { z } from "zod";

export const NewAssetSchema = z.object({
  name: z.string().describe("资产名称，仅为名称，不做其他表述"),
  desc: z.string().describe("资产描述"),
  type: z.enum(["role", "tool", "scene"]).describe("资产类型"),
  scriptIds: z.array(z.number()).describe("使用该资产的剧本 ID 数组"),
});

export const ExistingAssetRefSchema = z.object({
  name: z.string().describe("已有资产名称，必须与已有资产列表中的名称完全一致"),
  scriptIds: z.array(z.number()).describe("使用该资产的剧本 ID 数组"),
});

export const AssetExtractionToolResultSchema = z.object({
  newAssets: z.array(NewAssetSchema).describe("新发现的资产列表，需要完整的名称、描述、类型和剧本 ID"),
  existingAssetRefs: z.array(ExistingAssetRefSchema).describe("已有资产的引用列表，只包含名称和剧本 ID"),
});

export type NewAsset = z.infer<typeof NewAssetSchema>;
export type ExistingAssetRef = z.infer<typeof ExistingAssetRefSchema>;
export type AssetExtractionToolResult = z.infer<typeof AssetExtractionToolResultSchema>;

function decodeJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = fenced?.[1] ?? trimmed;

  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`资产提取结果的 ${field} 不是有效 JSON`);
  }
}

export function parseAssetExtractionToolInput(input: unknown): AssetExtractionToolResult {
  const decodedInput = decodeJson(input, "工具参数");
  if (!decodedInput || typeof decodedInput !== "object" || Array.isArray(decodedInput)) {
    throw new Error("资产提取结果必须是对象");
  }

  const candidate = decodedInput as Record<string, unknown>;
  const result = AssetExtractionToolResultSchema.safeParse({
    newAssets: decodeJson(candidate.newAssets, "newAssets"),
    existingAssetRefs: decodeJson(candidate.existingAssetRefs, "existingAssetRefs"),
  });
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")).filter(Boolean))];
    throw new Error(`资产提取结果格式无效：${fields.join("、") || "工具参数"}`);
  }
  return result.data;
}

export const assetExtractionToolInputSchema = jsonSchema<AssetExtractionToolResult>(
  AssetExtractionToolResultSchema.toJSONSchema(),
  {
    validate(value) {
      try {
        return { success: true, value: parseAssetExtractionToolInput(value) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  },
);
