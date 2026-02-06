import { readFileSync, existsSync, writeFileSync } from "fs";

function createDefaultEnvFile(path: string) {
  const defaultContent = ["# 环境变量配置", "NODE_ENV=dev"].join("\n");
  writeFileSync(path, defaultContent, { encoding: "utf8" });
  console.log(`[环境变量]: 已创建默认的 ${path}`);
}

function loadDotenvESM(envPath = ".env.local") {
  let finalPath: string;

  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    finalPath = app.getPath("userData") + `/${envPath}`;
    // 如果 userData 目录下的 env 文件不存在，则尝试当前目录
    if (!existsSync(finalPath)) {
      finalPath = envPath;
    }
  } else {
    finalPath = envPath;
  }

  // 若文件不存在，自动创建一个带默认内容的环境变量文件
  if (!existsSync(finalPath)) {
    createDefaultEnvFile(finalPath);
  }

  const text = readFileSync(finalPath, "utf8");
  for (const line of text.split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  console.log(`[环境变量]: 已加载 ${finalPath}`);
}

// 若非 Electron 环境，则加载 .env.local
if (typeof process.versions?.electron == "undefined") loadDotenvESM(".env.local");
