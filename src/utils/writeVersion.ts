import path from "path";
import fs from "fs";
import getPath from "@/utils/getPath";

declare const __APP_VERSION__: string | undefined;

const APP_VERSION: string = (() => {
  if (typeof __APP_VERSION__ !== "undefined") {
    return __APP_VERSION__;
  }
  // 开发环境回退：从 package.json 读取
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version;
})();

export default async (version?: string) => {
  const versionFile = path.join(getPath(), "update.json");
  if (!fs.existsSync(versionFile)) {
    fs.mkdirSync(path.dirname(versionFile), { recursive: true });
  }
  await fs.promises.writeFile(versionFile, JSON.stringify({ version: version ?? APP_VERSION }, null, 4), "utf8");
};

export const getVersion = async () => {
  const versionFile = path.join(getPath(), "update.json");
  if (fs.existsSync(versionFile)) {
    const data = JSON.parse(fs.readFileSync(versionFile, "utf8"));
    return data.version || null;
  }
  if (!fs.existsSync(versionFile)) {
    fs.mkdirSync(path.dirname(versionFile), { recursive: true });
  }
  await fs.promises.writeFile(versionFile, JSON.stringify({ version: APP_VERSION }, null, 4), "utf8");
  return APP_VERSION;
};
