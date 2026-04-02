import express from "express";
import z from "zod";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import fs from "fs";
import axios from "axios";
import compressing from "compressing";
import path from "path";
import { success, error } from "@/lib/responseFormat";
const router = express.Router();

const runInstaller = (installerPath: string) => {
  const { exec } = require("child_process");
  if (process.platform === "darwin") {
    exec(`open "${installerPath}"`);
  } else {
    if (process.platform !== "win32") fs.chmodSync(installerPath, 0o755);
    exec(`"${installerPath}"`);
  }
};

export default router.post(
  "/",
  validateFields({
    url: z.url(),
    reinstall: z.boolean(),
  }),
  async (req, res) => {
    const { reinstall, url } = req.body;
    const rootDir = u.getPath(["temp"]);
      fs.mkdirSync(rootDir, { recursive: true });
    if (reinstall) {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      const ext = path.extname(new URL(url).pathname) || (process.platform === "win32" ? ".exe" : process.platform === "darwin" ? ".dmg" : ".AppImage");
      const installerPath = path.join(rootDir, `latest${ext}`);
      fs.writeFileSync(installerPath, response.data);
      runInstaller(installerPath);
      res.status(200).send(success("安装包已下载并启动"));
    } else {
      const zip = await axios.get(url, { responseType: "arraybuffer" }).then((res) => res.data);
      fs.writeFileSync(`${rootDir}/latest.zip`, zip);
      await compressing.zip.uncompress(`${rootDir}/latest.zip`, rootDir);
      const tempServerPath = u.getPath(["temp", "serve"]);
      const webPath = u.getPath(["temp", "web"]);
      if (!fs.existsSync(tempServerPath) || !fs.existsSync(webPath)) {
        fs.rmSync(rootDir, { recursive: true, force: true });
        return res.status(400).send(error("服务器文件不存在"));
      }
      fs.cpSync(tempServerPath, u.getPath(["serve"]), { recursive: true });
      fs.cpSync(webPath, u.getPath(["web"]), { recursive: true });
      fs.rmSync(rootDir, { recursive: true, force: true });
      res.status(200).send(success("更新成功，5秒后重启"));
    }
  },
);
