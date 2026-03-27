import express from "express";
import { success, error } from "@/lib/responseFormat";
import getPath from "@/utils/getPath";
import z from "zod";
import fs from "fs";
import path from "path";
import axios from "axios";
import compressing from "compressing";
import { validateFields } from "@/middleware/middleware";
import { spawn } from "child_process";

const router = express.Router();

/** 仓库源配置 */
const REPO_SOURCES = {
  github: {
    repo: "HBAI-Ltd/Toonflow-app",
    api: "https://api.github.com/repos/HBAI-Ltd/Toonflow-app/releases/latest",
    headers: { Accept: "application/vnd.github.v3+json" },
  },
  gitee: {
    repo: "HBAI-Ltd/Toonflow-app",
    api: "https://gitee.com/api/v5/repos/HBAI-Ltd/Toonflow-app/releases/latest",
    headers: {},
  },
} as const;

type SourceType = keyof typeof REPO_SOURCES;

function normalizeAssets(source: SourceType, release: any): { name: string; browser_download_url: string }[] {
  if (source === "github") {
    return (release.assets ?? []).map((a: any) => ({
      name: a.name,
      browser_download_url: a.browser_download_url,
    }));
  }
  return (release.assets ?? []).map((a: any) => ({
    name: a.name,
    browser_download_url: a.browser_download_url,
  }));
}

/** 获取当前系统平台和架构标识，用于匹配安装包文件名 */
function getPlatformArch(): { platform: string; arch: string } {
  const platform = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return { platform, arch };
}

/** 匹配安装包资产（.exe / .dmg / .AppImage / .portable.exe） */
function findInstallerAsset(assets: any[]): any | null {
  const { platform, arch } = getPlatformArch();
  const installerExtensions: Record<string, string[]> = {
    win: [".exe"],
    mac: [".dmg"],
    linux: [".AppImage"],
  };
  const exts = installerExtensions[platform] || [".exe"];
  // 优先找 nsis 安装包（排除 portable），如果没有再找 portable
  return (
    assets.find(
      (a: any) =>
        exts.some((ext) => a.name.endsWith(ext)) &&
        a.name.includes(arch) &&
        !a.name.toLowerCase().includes("portable") &&
        !a.name.endsWith(".blockmap"),
    ) ??
    assets.find((a: any) => exts.some((ext) => a.name.endsWith(ext)) && a.name.includes(arch) && !a.name.endsWith(".blockmap")) ??
    null
  );
}

/**
 * 下载文件到指定路径（支持流式写入与进度）
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const response = await axios.get(url, {
    responseType: "stream",
    headers: { Accept: "application/octet-stream" },
    timeout: 600_000, // 10 分钟超时
  });

  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}
export default router.post(
  "/",
  validateFields({
    source: z.enum(["github", "gitee"]),
    reinstall: z.boolean(),
    latestVersion: z.string(),
  }),
  async (req, res) => {
    try {
      const { reinstall, latestVersion, source } = req.body as {
        reinstall: boolean;
        latestVersion: string;
        source: string;
      };

      if (!latestVersion) {
        return res.status(400).send(error("缺少目标版本号 latestVersion"));
      }

      const sourceConfig = REPO_SOURCES[source as SourceType] ?? REPO_SOURCES.github;

      // ─── 获取 Release 信息（支持 GitHub / Gitee） ──────────────────────
      let releaseRes;
      try {
        releaseRes = await axios.get(sourceConfig.api, {
          headers: sourceConfig.headers,
          timeout: 30_000,
        });
      } catch (e) {
        return res.status(500).send(error(`获取 ${source} Release 信息失败`));
      }

      const release = releaseRes.data;

      const assets = normalizeAssets(source as SourceType, release);

      if (reinstall) {
        // ═══════════════ 模式 A：下载完整安装包 ═══════════════
        const installerAsset = findInstallerAsset(assets);

        if (!installerAsset) {
          return res.status(404).send(error("未找到当前平台的安装包，请前往 GitHub Releases 手动下载"));
        }

        const tempDir = getPath(["temp"]);

        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const installerPath = path.join(tempDir, installerAsset.name);

        // 如果已经下载过相同文件，跳过下载
        if (!fs.existsSync(installerPath)) {
          await downloadFile(installerAsset.browser_download_url, installerPath);
        }

        // 使用 shell 打开安装程序
        const sub = spawn("cmd", ["/c", `${installerPath}`], {
          cwd: tempDir,
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        });

        sub.unref();

        return res.status(200).send(
          success({
            type: "reinstall",
            version: latestVersion,
            filePath: installerPath,
            message: "安装包已下载并打开，请按照安装向导完成更新",
          }),
        );
      } else {
        // ═══════════════ 模式 B：data 补丁热更新 ═══════════════
        const patchAsset = assets.find((a: any) => a.name.startsWith(latestVersion) && a.name.endsWith(".zip")) ?? null;

        if (!patchAsset) {
          return res.status(404).send(error("未找到 data 补丁包，请前往 GitHub Releases 手动下载"));
        }
        //

        const tempDir = getPath(["temp"]);
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const patchZipPath = path.join(tempDir, `${latestVersion}.zip`);

        // 下载补丁 zip
        await downloadFile(patchAsset.browser_download_url, patchZipPath);

        // 解压覆盖到 data 目录（同名文件夹先删除再解压，确保完全替换）
        const dataDir = getPath();

        // 先读取 zip 内的顶层文件夹/文件列表，删除 data 目录下的同名项
        const zipStream = new compressing.zip.UncompressStream({ source: patchZipPath, zipFileNameEncoding: "utf8" });
        const topLevelEntries = new Set<string>();
        await new Promise<void>((resolve, reject) => {
          zipStream.on("entry", (_header: any, stream: any, next: () => void) => {
            const entryName: string = _header.name || "";
            // 取顶层名称（第一个 / 之前的部分）
            const topName = entryName.split("/")[0];
            if (topName) topLevelEntries.add(topName);
            stream.resume();
            next();
          });
          zipStream.on("finish", resolve);
          zipStream.on("error", reject);
        });

        // 删除 data 目录下与 zip 顶层同名的文件夹/文件
        for (const name of topLevelEntries) {
          const targetPath = path.join(dataDir, name);
          if (fs.existsSync(targetPath)) {
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
              fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(targetPath);
            }
          }
        }

        await compressing.zip.uncompress(patchZipPath, dataDir, { zipFileNameEncoding: "utf8" });

        // 清理临时文件
        try {
          fs.unlinkSync(patchZipPath);
        } catch {
          // 忽略清理失败
        }

        return res.status(200).send(
          success({
            type: "patch",
            version: latestVersion,
            message: "补丁更新完成，请重启应用以使更新生效",
            restartRequired: true,
          }),
        );
      }
    } catch (err: any) {
      console.error("[downloadApp] 更新失败:", err);
      const message = err?.response?.status === 404 ? "未找到更新资源，请检查版本号或稍后重试" : (err?.message ?? "更新失败，请稍后重试");
      return res.status(500).send(error(message));
    }
  },
);
