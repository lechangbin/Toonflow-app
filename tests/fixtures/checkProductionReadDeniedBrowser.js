async page => {
  const base = page.url().split("/#/")[0];
  await page.goto(`${base}/#/login`);
  await page.getByRole("textbox", { name: "用户名" }).fill("admin");
  await page.getByRole("textbox", { name: "密码" }).fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  const welcomeGuide = page.getByRole("button", { name: "跳过引导" });
  await welcomeGuide.waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
  if (await welcomeGuide.isVisible()) await welcomeGuide.click();
  await page.getByText("Harness browser fixture").first().waitFor();
  await page.goto(`${base}/#/production`);
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("project") || "null");
    const selected = stored?.allProject?.find((entry) => entry.name === "Harness browser fixture");
    if (!selected) throw new Error("Browser fixture Project is missing");
    stored.project = selected;
    localStorage.setItem("project", JSON.stringify(stored));
  });
  await page.reload();
  const guide = page.getByRole("button", { name: "跳过", exact: true });
  await guide.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await guide.isVisible()) await guide.click();
  await page.getByRole("button", { name: "受控 Run（试用）" }).click();
  const panel = page.getByRole("region", { name: "生产 Agent 持久 Run" });
  const grant = panel.locator(".grantRow").filter({ hasText: "读取生产工作区" });
  await grant.getByText("读取生产工作区 · 已开启 · 版本 1").waitFor();
  await grant.getByRole("button", { name: "撤销" }).click();
  await grant.getByText("读取生产工作区 · 未开启 · 版本 2").waitFor();
  await panel.getByRole("textbox", {
    name: "描述要检查的拍摄计划、图片、派生资产、分镜或视频候选",
  }).fill("[production-read-fixture] 未授权时尝试读取生产工作区");
  await panel.getByRole("button", { name: "创建 Run" }).click();
  await page.waitForFunction(() => /Run [0-9a-f-]{36} · succeeded/u
    .test(document.querySelector(".productionHarness .runCard")?.textContent || ""),
  undefined, { timeout: 20_000 });
  const card = await panel.locator(".runCard").innerText();
  const runId = card.match(/Run ([0-9a-f-]{36}) · succeeded/u)?.[1];
  if (!runId || !card.includes("生产工作区读取被拒绝")) {
    throw new Error("Unauthorized Production read was not rejected by the local Model path");
  }
  await panel.getByRole("button", { name: "查看服务端因果证据" }).click();
  await panel.getByRole("listitem").filter({ hasText: "tool.denied" }).waitFor();
  if (await panel.getByRole("listitem").filter({ hasText: "tool.succeeded" }).count()) {
    throw new Error("Unauthorized Production read unexpectedly succeeded");
  }
  return { runId, grantVersion: 2, modelObservedDenial: true,
    deniedToolTraceCount: 1, successfulToolTraceCount: 0, provider: "local-fake-only" };
}
