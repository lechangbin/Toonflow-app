import u from "@/utils";
import { Socket } from "socket.io";

class ResTool {
  public socket: Socket;
  public data: Record<string, any>;
  constructor(socket: Socket, data: Record<string, any> = {}) {
    this.socket = socket;
    this.data = data;
  }

  textMessage(name: string = "AI") {
    const messageId = u.uuid();
    this.socket.emit("textMessage", {
      type: "start",
      messageId,
      delta: null,
      role: "assistant",
      name,
    });
    const handle = {
      send: (delta: string) => {
        this.socket.emit("textMessage", {
          type: "content",
          messageId,
          delta,
          role: "assistant",
          name,
        });
        return handle;
      },
      end: () => {
        this.socket.emit("textMessage", {
          type: "end",
          messageId,
          delta: null,
          role: "assistant",
          name,
        });
      },
    };
    return handle;
  }
  thinkMessage() {
    const messageId = u.uuid();
    this.socket.emit("thinkMessage", {
      type: "start",
      messageId,
      delta: null,
      role: "assistant",
    });
    const handle = {
      send: (delta: string) => {
        this.socket.emit("thinkMessage", {
          type: "content",
          messageId,
          delta,
          role: "assistant",
        });
        return handle;
      },
      end: () => {
        this.socket.emit("thinkMessage", {
          type: "end",
          messageId,
          delta: null,
          role: "assistant",
        });
      },
    };
    return handle;
  }
  systemMessage(content: string) {
    const messageId = u.uuid();
    this.socket.emit("systemMessage", { messageId, content });
  }
}

export default ResTool;
