import jwt from "jsonwebtoken";
import { getDatabaseRuntime } from "@/database";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/productionAgent/index";
import ResTool from "@/socket/resTool";
import { createLegacyStopLifecycle } from "@/socket/legacyStopLifecycle";
import { authorizeLegacyProductionContext } from "@/socket/legacyProductionContext";

async function verifyToken(rawToken: string): Promise<number | null> {
  const setting = await getDatabaseRuntime().work((db) =>
    db("o_setting").where("key", "tokenKey").select("value").first(),
  );
  if (!setting) return null;
  const { value: tokenKey } = setting;
  if (!rawToken) return null;
  const token = rawToken.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, tokenKey as string);
    return typeof payload !== "string" && Number.isSafeInteger(payload.id) && payload.id > 0
      ? payload.id : null;
  } catch (err) {
    return null;
  }
}

async function authorizeContext(actorUserId: number | null, input: {
  projectId: unknown; scriptId: unknown; isolationKey: unknown;
}) {
  return authorizeLegacyProductionContext({ actorUserId, ...input },
    (projectId, userId) => getDatabaseRuntime().work(async (db) => Boolean(await db("o_project")
      .where({ id: projectId, userId }).first("id"))),
    (projectId, scriptId) => getDatabaseRuntime().work(async (db) => Boolean(await db("o_script")
      .where({ id: scriptId, projectId }).first("id"))));
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    const actorUserId = typeof token === "string" ? await verifyToken(token) : null;
    const initialContext = await authorizeContext(actorUserId, {
      projectId: socket.handshake.auth.projectId,
      scriptId: socket.handshake.auth.scriptId,
      isolationKey: socket.handshake.auth.isolationKey,
    });
    if (!initialContext) {
      console.log("[productionAgent] 连接失败，身份或项目上下文无效");
      socket.disconnect();
      return;
    }
    let context = initialContext;

    console.log("[productionAgent] 已连接:", socket.id);

    let resTool = new ResTool(socket, { projectId: context.projectId, scriptId: context.scriptId });
    const lifecycle = createLegacyStopLifecycle();
    let contextUpdateSeq = 0;

    const thinkConfig: agent.AgentContext["thinkConfig"] = {
      think: false,
      thinlLevel: 0,
    };

    socket.on("updateContext", async (data: { isolationKey: string; projectId: number; scriptId: number }, callback) => {
      const seq = ++contextUpdateSeq;
      const next = await authorizeContext(actorUserId, data ?? {});
      if (!next || seq !== contextUpdateSeq) {
        callback?.({ success: false });
        return;
      }
      lifecycle.stop();
      context = next;
      resTool = new ResTool(socket, { projectId: next.projectId, scriptId: next.scriptId });
      console.log("[productionAgent] 上下文已更新:", next.isolationKey);
      callback?.({ success: true });
    });

    socket.on("chat", async (data: { content: string }) => {
      if (context.scriptId === null) return;
      const { content } = data;
      const currentController = new AbortController();

      const msg = resTool.newMessage("assistant", "视频策划");
      lifecycle.start(currentController, msg);
      const ctx: agent.AgentContext = {
        socket,
        isolationKey: context.isolationKey,
        text: content,
        userMessageTime: new Date(msg.datetime).getTime() - 1,
        abortSignal: currentController.signal,
        resTool,
        msg,
        thinkConfig,
      };

      try {
        await agent.runDecisionAI(ctx);
      } catch (err: any) {
        if (err.name !== "AbortError" && !currentController.signal.aborted) {
          console.error("[productionAgent] chat failed");
        }
      } finally {
        lifecycle.finish(currentController);
      }
    });

    socket.on("updateThinkConfig", (data: { think: boolean; thinlLevel: 0 | 1 | 2 | 3 }) => {
      thinkConfig.think = data.think;
      thinkConfig.thinlLevel = data.thinlLevel;
      console.log("[productionAgent] 更新思考配置:", thinkConfig);
    });

    socket.on("stop", () => {
      lifecycle.stop();
    });
    socket.on("disconnect", () => {
      contextUpdateSeq++;
      lifecycle.stop();
    });
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[productionAgent] 已断开连接:", socket.id);
  });
};
