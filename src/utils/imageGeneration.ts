import axios from "axios";

import type { ImageGenerationInput } from "@/vendor/contract";

/**
 * Legacy reference conversion retained at the caller boundary.
 *
 * Historically `src/utils/ai.ts` translated the typed `referenceList` into the
 * `imageBase64: string[]` shape that Vendor programs with a declared version
 * below 2.0 (or without a numeric version) consumed. This preserves that
 * contract without moving it into the configured Vendor module.
 */
export function applyLegacyImageReferenceConversion(
  version: string | undefined,
  input: ImageGenerationInput,
): ImageGenerationInput {
  const parsedVersion = version ? parseFloat(version) : Number.NaN;
  if (Number.isNaN(parsedVersion) || parsedVersion < 2.0) {
    return { ...input, imageBase64: (input.referenceList ?? []).map((item) => item.base64) } as ImageGenerationInput;
  }
  return input;
}

/**
 * URL -> base64 normalization. Retained from the legacy
 * `AiImage`/`AiVideo`/`AiAudio` result path: a generation result that is an
 * http(s) URL is downloaded and converted to base64 before persistence.
 */
export async function urlToBase64(url: string, retries = 3, delay = 1000): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { responseType: "arraybuffer" });
      const base64 = Buffer.from(res.data).toString("base64");
      return `${base64}`;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
  throw new Error("urlToBase64 failed");
}

/** Applies the retained URL -> base64 normalization to a generation result. */
export async function normalizeHttpResult(result: string): Promise<string> {
  return result.startsWith("http") ? urlToBase64(result) : result;
}
