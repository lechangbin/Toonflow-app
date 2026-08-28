import path from "node:path";

import { initializeRuntimeData } from "@/server/runtimeData";

async function main() {
  const runtimeDir = path.resolve(process.env.DATA_DIR?.trim() || "/app/data");
  const seedDir = path.resolve(process.env.SEED_DATA_DIR?.trim() || "/app/seed-data");
  const result = await initializeRuntimeData({ runtimeDir, seedDir });
  console.log(`[runtime-data] ${result.status}: seed ${result.version}`);
}

main().catch((error) => {
  console.error("[runtime-data] initialization failed", error);
  process.exitCode = 1;
});
