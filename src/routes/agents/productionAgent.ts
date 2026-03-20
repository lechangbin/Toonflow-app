import express from "express";
import { createAGUIStream } from "@/utils/agent/aguiTools";
import * as agent from "@/agents/productionAgent/index";

const router = express.Router();

export default router.post("/", async (req, res) => {
  const { prompt: text, projectId, episodesId } = req.body;
  const isolationKey = `${projectId}:${episodesId}`;

  const agui = createAGUIStream(res);
  agui.runStarted();

  const textStream = await agent.decisionAI(agui, isolationKey, text);

  let msg: ReturnType<typeof agui.textMessage> | null = null;
  let fullResponse = "";

  for await (const chunk of textStream) {
    if (!msg) msg = agui.textMessage();
    msg.send(chunk);
    fullResponse += chunk;
  }

  msg?.end();

  agui.runFinished();
  agui.end();
});
