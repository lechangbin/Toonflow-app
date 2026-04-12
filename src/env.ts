import dotenv from "dotenv";
import path from "node:path";

// 判断是否为打包后的 Electron 环境
const isElectron = typeof process.versions?.electron !== "undefined";
let isPackaged = false;
if (isElectron) {
  const { app } = require("electron");
  isPackaged = app.isPackaged;
}

// 仅在非 Electron 环境加载 .env（例如 Docker / Web 后端）
if (!isElectron) {
  dotenv.config({
    path: path.resolve(process.cwd(), ".env"),
  });
}

//加载环境变量（打包环境默认使用 prod）
const env = process.env.NODE_ENV;
if (!env) {
  if (isElectron) process.env.NODE_ENV = "prod";
  else process.env.NODE_ENV = "dev";
  console.log(`[环境变量：${process.env.NODE_ENV}]`);
}
