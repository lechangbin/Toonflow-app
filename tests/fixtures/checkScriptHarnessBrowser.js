async page => {
  const base = page.url().split("/#/")[0];
  await page.goto(`${base}/#/login`);
  await page.getByRole("textbox", { name: "用户名" }).fill("admin");
  await page.getByRole("textbox", { name: "密码" }).fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByText("Harness browser fixture").first().waitFor();
  const guide = page.getByRole("button", { name: "跳过引导" });
  if (await guide.isVisible()) await guide.click();
  await page.goto(`${base}/#/scriptAgent`);
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("project") || "null");
    const selected = stored?.allProject?.find((entry) => entry.name === "Harness browser fixture");
    if (!selected) throw new Error("Browser fixture Project is missing");
    stored.project = selected;
    localStorage.setItem("project", JSON.stringify(stored));
  });
  await page.reload();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await page.getByRole("button", { name: "试用监督 Harness" }).isVisible()) break;
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("project") || "null");
      stored.project = stored.allProject.find((entry) => entry.name === "Harness browser fixture");
      localStorage.setItem("project", JSON.stringify(stored));
    });
    await page.reload();
  }
  await page.getByRole("button", { name: "试用监督 Harness" }).click();
  const input = page.locator(".inputBox textarea");
  const send = page.locator("button.t-chat-sender__button__default");
  const priorId = (await page.locator(".harnessStatus").innerText())
    .match(/Run ([0-9a-f-]{36}) · /)?.[1] ?? null;
  await input.fill("请给出只读建议（本地浏览器夹具）");
  await send.click();
  await page.waitForFunction((previous) => {
    const text = document.querySelector(".harnessStatus")?.textContent || "";
    const matched = text.match(/Run ([0-9a-f-]{36}) · succeeded/);
    return matched && matched[1] !== previous && text.includes("本地假模型：只读建议已完成。");
  }, priorId, { timeout: 20_000 });
  const firstStatus = await page.locator(".harnessStatus").innerText();
  const firstRunId = firstStatus.match(/Run ([0-9a-f-]{36}) · succeeded/)?.[1];
  if (!firstRunId) throw new Error("First Script Run did not succeed");
  await page.getByRole("button", { name: "查看服务端因果证据" }).click();
  await page.getByText(/#3 · run.succeeded/).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "试用监督 Harness" }).click();
  await page.locator(".harnessStatus").getByText(`Run ${firstRunId} · succeeded`).waitFor();
  await input.fill("[slow-fixture] 在运行中请求停止");
  await send.click();
  await page.locator(".t-chat-sender__button__stopicon").waitFor({ timeout: 5_000 });
  await send.click();
  await page.waitForFunction(() => /Run [0-9a-f-]{36} · (succeeded|cancelled|failed|waiting)/u
    .test(document.querySelector(".harnessStatus")?.textContent || ""), undefined, { timeout: 20_000 });
  const stopped = await page.locator(".harnessStatus").innerText();
  const stopMatch = stopped.match(/Run ([0-9a-f-]{36}) · (succeeded|cancelled|failed|waiting)/);
  if (!stopMatch || stopMatch[1] === firstRunId) throw new Error("Stop did not address a new Run");
  await page.getByRole("button", { name: "查看服务端因果证据" }).click();
  const trace = await page.locator(".harnessStatus").innerText();
  if (stopMatch[2] === "succeeded" && !trace.includes("run.cancellation-requested")) {
    throw new Error("Late success concealed the cancellation intent");
  }
  return { firstRunId, stopRunId: stopMatch[1], stopStatus: stopMatch[2],
    traceHasCancellationIntent: trace.includes("run.cancellation-requested"),
    provider: "local-fake-only" };
}
