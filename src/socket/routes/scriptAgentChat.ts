import { Namespace, Socket } from "socket.io";

const users = new Map<string, string>(); // socketId -> username

export default (nsp: Namespace) => {
  nsp.on("connection", (socket: Socket) => {
    console.log("[chat] 用户已连接:", socket.id);

    socket.on("userLogin", (username: string) => {
      users.set(socket.id, username);
      socket.broadcast.emit("notification", `${username} 加入了聊天室`);
    });

    socket.on("sendMessage", (data: { message: string }) => {
      const username = users.get(socket.id) || "匿名";
      const msg = {
        type: "user" as const,
        username,
        message: data.message,
        time: new Date().toLocaleTimeString(),
      };
      nsp.emit("newMessage", msg);
    });

    socket.on("typing", () => {
      const username = users.get(socket.id);
      if (username) socket.broadcast.emit("userTyping", username);
    });

    socket.on("stopTyping", () => {
      socket.broadcast.emit("userStopTyping");
    });

    socket.on("disconnect", () => {
      const username = users.get(socket.id);
      if (username) {
        users.delete(socket.id);
        socket.broadcast.emit("notification", `${username} 离开了聊天室`);
      }
      console.log("[chat] 用户已断开:", socket.id);
    });
  });
};
