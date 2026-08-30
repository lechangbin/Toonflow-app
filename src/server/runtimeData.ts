import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const VERSIONED_SEED_ENTRIES = [
  "assets",
  "models",
  "promptProfiles",
  "skills",
  "vendor",
  "web",
  "version.txt",
] as const;

const SEED_MARKER = ".toonflow-seed.json";

export interface RuntimeDataInitializationOptions {
  runtimeDir: string;
  seedDir: string;
}

export interface RuntimeDataInitializationResult {
  status: "existing" | "initialized";
  version: string;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readSeedVersion(seedDir: string): Promise<string> {
  const version = (await readFile(path.join(seedDir, "version.txt"), "utf8")).trim();
  if (!version) throw new Error("Seed data version.txt must not be empty");
  return version;
}

async function readExistingSeedVersion(runtimeDir: string): Promise<string | undefined> {
  try {
    const marker = JSON.parse(await readFile(path.join(runtimeDir, SEED_MARKER), "utf8")) as { version?: unknown };
    if (typeof marker.version !== "string" || !marker.version) {
      throw new Error(`Invalid runtime seed marker at ${path.join(runtimeDir, SEED_MARKER)}`);
    }
    return marker.version;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

export async function initializeRuntimeData({
  runtimeDir,
  seedDir,
}: RuntimeDataInitializationOptions): Promise<RuntimeDataInitializationResult> {
  const version = await readSeedVersion(seedDir);
  await mkdir(runtimeDir, { recursive: true });

  const existingVersion = await readExistingSeedVersion(runtimeDir);
  if (existingVersion) {
    if (existingVersion !== version) {
      throw new Error(
        `Runtime data was initialized from seed ${existingVersion}, but this image provides ${version}; use a new versioned volume`,
      );
    }
    return { status: "existing", version };
  }

  const existingEntries = await readdir(runtimeDir);
  if (existingEntries.length > 0) {
    throw new Error(
      `Runtime data directory is not empty and has no seed marker: ${runtimeDir}. Use an empty versioned volume.`,
    );
  }

  for (const entry of VERSIONED_SEED_ENTRIES) {
    try {
      await cp(path.join(seedDir, entry), path.join(runtimeDir, entry), {
        errorOnExist: false,
        force: false,
        recursive: true,
      });
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  await writeFile(path.join(runtimeDir, SEED_MARKER), `${JSON.stringify({ version })}\n`, {
    flag: "wx",
  });
  return { status: "initialized", version };
}
