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
  const selectFixture = () => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("project") || "null");
    const selected = stored?.allProject?.find((entry) => entry.name === "Harness browser fixture");
    if (!selected) throw new Error("Browser fixture Project is missing");
    stored.project = selected;
    localStorage.setItem("project", JSON.stringify(stored));
    return selected.id;
  });
  const projectId = await selectFixture();
  await page.reload();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await page.getByRole("button", { name: "试用监督 Harness" }).isVisible()) break;
    await selectFixture();
    await page.reload();
  }
  await page.getByRole("button", { name: "试用监督 Harness" }).click();
  await page.getByRole("button", { name: /规划候选：/u }).waitFor();
  if (await page.getByRole("button", { name: "规划候选：未允许" }).isVisible()) {
    await page.getByRole("button", { name: "规划候选：未允许" }).click();
    await page.getByRole("button", { name: "允许提出候选" }).click();
  }
  await page.getByRole("button", { name: "规划候选：已允许" }).waitFor();
  const input = page.locator(".inputBox textarea");
  await input.fill("[propose-fixture] 提出故事骨架候选");
  await page.locator("button.t-chat-sender__button__default").click();
  await page.getByText("本地假模型：已提出待审批候选。").waitFor({ timeout: 20_000 });
  const runStatus = await page.locator(".harnessStatus").innerText();
  const runId = runStatus.match(/Run ([0-9a-f-]{36}) · succeeded/u)?.[1];
  if (!runId) throw new Error("Model proposal parent Run did not succeed");
  await page.getByRole("button", { name: "查看服务端因果证据" }).click();
  await page.getByText(/tool\.proposal\.created/u).waitFor();
  await page.getByRole("button", { name: "刷新写入提案" }).click();
  const card = page.locator(".harnessApproval").filter({ hasText: `来自模型 Run ${runId}` });
  await card.getByText(/workspace · pending/u).waitFor();
  const readPlan = () => page.evaluate(async (projectId) => {
    const response = await fetch("/api/scriptAgent/getPlanData", {
      method: "POST", headers: { "Content-Type": "application/json",
        Authorization: localStorage.getItem("token") || "" },
      body: JSON.stringify({ projectId, agentType: "scriptAgent" }),
    });
    if (!response.ok) throw new Error(`Plan read returned ${response.status}`);
    return (await response.json()).data.data;
  }, projectId);
  if ((await readPlan()).storySkeleton === "本地假模型提出的待审批骨架") {
    throw new Error("Model proposal wrote the Project before Owner approval");
  }
  await card.getByRole("button", { name: "查看待写入全文" }).click();
  await card.getByText("本地假模型提出的待审批骨架").waitFor();
  await card.getByRole("button", { name: "批准", exact: true }).click();
  await page.getByRole("button", { name: "批准精确目标" }).click();
  await card.getByText(/workspace · approved/u).waitFor();
  await page.waitForFunction(async (projectId) => {
    const response = await fetch("/api/scriptAgent/getPlanData", {
      method: "POST", headers: { "Content-Type": "application/json",
        Authorization: localStorage.getItem("token") || "" },
      body: JSON.stringify({ projectId, agentType: "scriptAgent" }),
    });
    if (!response.ok) throw new Error(`Plan read returned ${response.status}`);
    return (await response.json()).data.data.storySkeleton === "本地假模型提出的待审批骨架";
  }, projectId, { timeout: 10_000 });
  return { parentRunId: runId, approvalRunId: (await card.innerText()).match(/[0-9a-f-]{36}/u)?.[0],
    modelToolProposalApproved: true, provider: "local-fake-only" };
}
