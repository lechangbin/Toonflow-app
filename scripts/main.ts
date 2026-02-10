import { app, BrowserWindow } from "electron";
import path from "path";
import startServe, { closeServe } from "src/app";

function createMainWindow(): void {
  const isDev = process.env.NODE_ENV === "dev" || !app.isPackaged;
  const basePath = isDev ? process.cwd() : app.getAppPath();

  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: true,
    autoHideMenuBar: true,
    icon: path.join(
      basePath,
      "scripts",
      process.platform === "win32" ? "logo.ico" : "logo.png"
    ),
  });
  const htmlPath = path.join(basePath, "scripts", "web", "index.html");
  void win.loadFile(htmlPath);
}
app.whenReady().then(async () => {
  createMainWindow();
  await startServe();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("before-quit", async (event) => {
  await closeServe();
});
