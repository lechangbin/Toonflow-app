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
  const projectId = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("project") || "null");
    const selected = stored?.allProject?.find((entry) => entry.name === "Harness browser fixture");
    if (!selected) throw new Error("Browser fixture Project is missing");
    stored.project = selected;
    localStorage.setItem("project", JSON.stringify(stored));
    return selected.id;
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
  const post = (path, body) => page.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api${path}`, {
      method: "POST", headers: { "Content-Type": "application/json",
        Authorization: localStorage.getItem("token") || "" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Fixture ${path} returned ${response.status}`);
    return (await response.json()).data;
  }, { path, body });
  const before = (await post("/scriptAgent/getPlanData",
    { projectId, agentType: "scriptAgent" })).data;
  const marker = `本地审批夹具骨架-${Date.now()}`;
  const makeProposal = (key, content) => post("/agentRuns/scriptWriteApprovals/propose", {
    projectId, clientRequestId: `browser-${Date.now()}-${Math.random()}`,
    operationId: `operation-${Date.now()}-${Math.random()}`,
    kind: "workspace", payload: { key, content },
  });
  const approved = await makeProposal("storySkeleton", marker);
  await page.getByRole("button", { name: "刷新写入提案" }).click();
  const approvedCard = page.locator(".harnessApproval").filter({ hasText: approved.runId });
  await approvedCard.getByText(/workspace · pending/u).waitFor();
  await approvedCard.getByRole("button", { name: "查看待写入全文" }).click();
  await approvedCard.getByText(marker).waitFor();
  await approvedCard.getByRole("button", { name: "批准", exact: true }).click();
  await page.getByRole("button", { name: "批准精确目标" }).click();
  await approvedCard.getByText(/workspace · approved/u).waitFor();
  const rejected = await makeProposal("adaptationStrategy", "这段内容必须被拒绝");
  await page.getByRole("button", { name: "刷新写入提案" }).click();
  const rejectedCard = page.locator(".harnessApproval").filter({ hasText: rejected.runId });
  await rejectedCard.getByText(/workspace · pending/u).waitFor();
  await rejectedCard.getByRole("button", { name: "拒绝", exact: true }).click();
  await page.getByRole("button", { name: "拒绝", exact: true }).last().click();
  await rejectedCard.getByText(/workspace · rejected/u).waitFor();
  const after = (await post("/scriptAgent/getPlanData",
    { projectId, agentType: "scriptAgent" })).data;
  if (after.storySkeleton !== marker || after.adaptationStrategy !== before.adaptationStrategy) {
    throw new Error("Approval or rejection changed the wrong Script workspace field");
  }
  return { approvedRunId: approved.runId, rejectedRunId: rejected.runId,
    approvedFieldChanged: true, rejectedFieldUnchanged: true,
    proposalSource: "local-owner-endpoint-not-model-tool", provider: "local-fake-only" };
}
