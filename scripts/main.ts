import { app, BrowserWindow, dialog } from "electron";
import path from "path";
import net from "net";
import startServe, { closeServe } from "src/app";

// 检测端口是否被占用
function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        
        resolve(true); // 端口被占用
      } else {
        
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      
      resolve(false); // 端口可用
    });
    
    server.listen(port);
  });
}

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
  const port = parseInt(process.env.PORT || "60000");
  const isPortInUse = await checkPortInUse(port);
  
  
  if (isPortInUse) {
    
    await dialog.showErrorBox(
      "端口被占用",
      `端口 ${port} 已被占用，请关闭占用该端口的程序后重试。\n\n您可以使用以下命令查看占用端口的程序：\nWindows: netstat -ano | findstr ${port}\nLinux/Mac: lsof -i :${port}`
    );
    app.quit();
    return;
  }
  
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
