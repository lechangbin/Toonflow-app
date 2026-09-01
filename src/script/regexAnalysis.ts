import type { Knex } from "knex";

import type { ConfiguredVendor } from "@/vendor";
import { parseVendorModelName } from "@/vendor";
import type { TextModelTarget } from "@/vendor/contract";
import { stripThink } from "@/utils/stripThink";

type RegexAnalysisVendor = Pick<ConfiguredVendor, "listVendors" | "inspectVendor">;

function positionalCaptureCount(source: string): number {
  let count = 0;
  let escaped = false;
  let inCharacterClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") inCharacterClass = true;
    if (character === "]") inCharacterClass = false;
    if (!inCharacterClass && character === "(" && source[index + 1] !== "?") count += 1;
  }
  return count;
}

export function normalizeAiRegex(raw: string): string {
  let candidate = stripThink(raw).trim();
  const fenced = candidate.match(/^```(?:regex|javascript|js)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) candidate = fenced[1].trim();
  if (candidate.startsWith('"') && candidate.endsWith('"')) {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      // The literal parser below produces the actionable error.
    }
  }

  const literal = candidate.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
  const source = literal?.[1] ?? candidate;
  const flags = literal?.[2] ?? "";
  try {
    const compiled = new RegExp(source, flags.includes("g") ? flags : `${flags}g`);
    if (positionalCaptureCount(compiled.source) < 2) throw new Error("capture groups missing");
    return `/${compiled.source}/${compiled.flags}`;
  } catch {
    throw new Error("AI 未返回有效的正则表达式（必须包含集数和标题两个捕获组）");
  }
}

export async function resolveRegexAnalysisTarget(
  database: Knex,
  vendor: RegexAnalysisVendor,
): Promise<TextModelTarget> {
  const bindings = await database("o_agentDeploy")
    .whereIn("key", ["universalAi", "scriptAgent"])
    .select("key", "modelName");
  const byKey = new Map(bindings.map((binding) => [binding.key, binding.modelName]));
  for (const key of ["universalAi", "scriptAgent"]) {
    const modelName = byKey.get(key);
    if (typeof modelName === "string" && modelName.trim()) {
      return { kind: "direct", ...parseVendorModelName(modelName) };
    }
  }

  const candidates = (await vendor.listVendors())
    .filter((item) => item.enabled && item.modelTypes.includes("text"))
    .sort((left, right) => left.modelTypes.length - right.modelTypes.length || left.vendorId.localeCompare(right.vendorId));
  for (const candidate of candidates) {
    const inspection = await vendor.inspectVendor(candidate.vendorId);
    const textModel = inspection.models.find((model) => model.type === "text");
    if (textModel) return { kind: "direct", vendorId: candidate.vendorId, modelId: textModel.modelName };
  }

  throw new Error("AI 正则分析没有可用的文本模型，请先在设置中启用文本供应商或配置通用 AI");
}
