import { Server } from "socket.io";
import productionAgent from "./routes/productionAgent";
import chat from "./routes/chat";

export default (io: Server) => {
  const routes: Record<string, (nsp: ReturnType<Server["of"]>) => void> = {
    productionAgent,
    chat,
  };

  for (const [name, handler] of Object.entries(routes)) {
    const nsp = io.of(`/api/socket/${name}`);
    handler(nsp);
    console.log(`[Socket] 注册命名空间: /api/socket/${name}`);
  }
};
