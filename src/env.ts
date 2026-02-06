import { readFileSync, existsSync } from "fs";

function loadDotenvESM(envPath = ".env.local") {
  // 尝试从 userData 目录读取环境变量，如果不存在则使用当前目录
  let finalPath: string;

  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    finalPath = app.getPath("userData");
    // 如果 userData 目录中不存在，尝试使用当前目录
    if (!existsSync(finalPath)) {
      finalPath = envPath;
    }
  } else {
    finalPath = envPath;
  }

  if (!existsSync(finalPath)) {
    console.log(`[环境变量]: ${envPath} 文件不存在`);
    return;
  }

  const text = readFileSync(finalPath, "utf8");
  for (const line of text.split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  console.log(`[环境变量]: ${finalPath}`);
}

if (typeof process.versions?.electron == "undefined") loadDotenvESM(".env.local");
