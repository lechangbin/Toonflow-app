import jwt from "jsonwebtoken";
import { getDatabaseRuntime } from "@/database";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/scriptAgent/index";
import ResTool from "@/socket/resTool";

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
    if (typeof payload === "string" || !Number.isSafeInteger(payload.id) || payload.id <= 0) return null;
    return payload.id;
  } catch (err) {
    return null;
  }
}

/** Legacy compatibility boundary: the client-provided key cannot select another Project's Memory. */
export async function authorizeLegacyScriptSocket(input: {
  actorUserId: number | null; projectId: unknown; isolationKey: unknown;
}, projectOwned: (projectId: number, actorUserId: number) => Promise<boolean>): Promise<boolean> {
  const { actorUserId, projectId, isolationKey } = input;
  const normalizedProjectId = typeof projectId === "string" && /^[1-9]\d*$/u.test(projectId)
    ? Number(projectId) : projectId;
  if (!Number.isSafeInteger(actorUserId) || actorUserId! <= 0
    || !Number.isSafeInteger(normalizedProjectId) || (normalizedProjectId as number) <= 0
    || isolationKey !== `${normalizedProjectId}:scriptAgent`) return false;
  return projectOwned(normalizedProjectId as number, actorUserId!);
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    const actorUserId = typeof token === "string" ? await verifyToken(token) : null;
    const projectId = socket.handshake.auth.projectId;
    const isolationKey = socket.handshake.auth.isolationKey;
    if (!await authorizeLegacyScriptSocket({ actorUserId, projectId, isolationKey },
      (id, ownerId) => getDatabaseRuntime().work(async (db) => Boolean(await db("o_project")
        .where({ id, userId: ownerId }).first("id"))))) {
      console.log("[scriptAgent] 连接失败，身份或项目上下文无效");
      socket.disconnect();
      return;
    }

    console.log("[scriptAgent] 已连接:", socket.id);

    const resTool = new ResTool(socket, {
      projectId,
    });
    let abortController: AbortController | null = null;

    const thinkConfig: agent.AgentContext["thinkConfig"] = {
      think: false,
      thinlLevel: 0,
    };

    socket.on("chat", async (data: { content: string }) => {
      const { content } = data;
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      const msg = resTool.newMessage("assistant", "统筹");
      const ctx: agent.AgentContext = {
        socket,
        isolationKey,
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
          console.error("[scriptAgent] chat failed");
          msg.error("Agent 执行失败");
        }
      } finally {
        if (abortController === currentController) {
          abortController = null;
        }
      }
    });

    socket.on("updateThinkConfig", (data: { think: boolean; thinlLevel: 0 | 1 | 2 | 3 }) => {
      thinkConfig.think = data.think;
      thinkConfig.thinlLevel = data.thinlLevel;
      console.log("[scriptAgent] 更新思考配置:", thinkConfig);
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[scriptAgent] 已断开连接:", socket.id);
  });
};
