import http from "node:http";

const port = Number(process.env.FAKE_TEXT_MODEL_PORT || "10689");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new TypeError("FAKE_TEXT_MODEL_PORT must be a TCP port");
}

let calls = 0;
const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ calls }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404);
    response.end();
    return;
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      response.writeHead(413);
      response.end();
      return;
    }
  }
  const parsed = JSON.parse(body);
  const userText = parsed.messages?.filter((entry) => entry.role === "user")
    .map((entry) => typeof entry.content === "string" ? entry.content : "").join("\n") ?? "";
  const delayMs = userText.includes("[slow-fixture]") ? 8_000 : 0;
  calls += 1;
  console.log(JSON.stringify({ event: "fake-model-call", ordinal: calls, delayMs }));
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ id: `fake-chat-${calls}`, object: "chat.completion",
    created: Math.floor(Date.now() / 1000), model: "fixture-text",
    choices: [{ index: 0, message: { role: "assistant", content: "本地假模型：只读建议已完成。" },
      finish_reason: "stop" }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
});
server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ event: "ready", port })));
