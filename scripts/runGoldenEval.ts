import fs from "node:fs";
import path from "node:path";

import { runGoldenEval } from "../src/eval/goldenEval";

const root = process.cwd();
const manifestPath = path.resolve(root, "data/eval/agent-harness-golden-v1/manifest.json");
const outputPath = path.resolve(root, "docs/reports/data/agent-harness-golden-v1-results.json");
const shouldWrite = process.argv.includes("--write");

async function main(): Promise<void> {
  const result = await runGoldenEval({ manifestPath });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;

  if (shouldWrite) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, "utf8");
  }

  process.stdout.write(serialized);
  if (result.summary.hardGate.failed > 0) process.exitCode = 1;
}

void main();
