import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
const router = express.Router();

import fs from "fs";
import path from "path";

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

export default router.post(
  "/",
  validateFields({
    source: z.enum(["toonflow", "github", "gitee", "atomgit"]),
  }),
  async (req, res) => {
    const { source } = req.body;

    const getUrl: any = {
      toonflow: "http://localhost:5173/update.json",
      github: "https://api.github.com/repos/toonflow/toonflow/releases/latest",
      gitee: "https://gitee.com/api/v5/repos/toonflow/toonflow/releases/latest",
      atomgit: "https://api.github.com/repos/atomgit/atomgit/releases/latest",
    };

    const vsersion = await fetch(getUrl[source]).then((res) => res.json());
    if (!vsersion) return res.status(400).send(error("无法获取版本信息"));
    const { version: tagger, time, data } = vsersion;

    const platformType: Record<string, string> = {
      win32: "windows",
      darwin: "macos",
      linux: "linux",
    };

    const zipItem = data.find((d: any) => d.type === "zip");
    const installerItem = data.find((d: any) => d.type === platformType[process.platform]);

    const taggerList = tagger.split(".").map(Number);
    const currentVersionList = APP_VERSION.split(".").map(Number);
    //对比Major
    if (taggerList[0] > currentVersionList[0]) {
      return res.status(200).send(success({ needUpdate: true, latestVersion: tagger, reinstall: true, time, url: installerItem?.url }));
    }
    //对比Minor
    if (taggerList[1] > currentVersionList[1]) {
      return res.status(200).send(success({ needUpdate: true, latestVersion: tagger, reinstall: true, time, url: installerItem?.url }));
    }
    //Patch
    if (taggerList[2] > currentVersionList[2]) {
      return res.status(200).send(success({ needUpdate: true, latestVersion: tagger, reinstall: false, time, url: zipItem?.url }));
    }
    return res.status(200).send(success({ needUpdate: false, latestVersion: tagger, reinstall: false, time }));
  },
);
