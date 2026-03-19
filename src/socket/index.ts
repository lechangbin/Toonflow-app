import { Server } from "socket.io";
import scriptAgentChat from "./routes/scriptAgentChat";
import chat from "./routes/chat";

export default (io: Server) => {
  const routes: Record<string, (nsp: ReturnType<Server["of"]>) => void> = {
    scriptAgentChat,
    chat,
  };

  for (const [name, handler] of Object.entries(routes)) {
    const nsp = io.of(`/socket/${name}`);
    handler(nsp);
    console.log(`[Socket] 注册命名空间: /socket/${name}`);
  }
};
