import path from "path";

export default (fileName?: string[] | string) => {
  let dbPath: string;
  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    const userDataDir: string = app.getPath("userData");
    dbPath = path.join(userDataDir, "data");
  } else {
    dbPath = path.join(process.cwd(), "data");
  }
  if (fileName) {
    if (Array.isArray(fileName)) {
      dbPath = path.join(dbPath, ...fileName);
    } else {
      dbPath = path.join(dbPath, fileName);
    }
  }
  return dbPath;
};
