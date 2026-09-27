async page => {
  const base = page.url().split("/#/")[0];
  await page.goto(`${base}/#/login`);
  await page.getByRole("textbox", { name: "用户名" }).fill("admin");
  await page.getByRole("textbox", { name: "密码" }).fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByText("Harness browser fixture").first().waitFor();
  const welcomeGuide = page.getByRole("button", { name: "跳过引导" });
  if (await welcomeGuide.isVisible()) await welcomeGuide.click();
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
  await panel.getByRole("textbox", {
    name: "描述要检查的拍摄计划、图片、派生资产、分镜或视频候选",
  }).fill("[slow-fixture] 在 Model intent 后中断本地服务");
  await panel.getByRole("button", { name: "创建 Run" }).click();
  await page.waitForFunction(() => /Run [0-9a-f-]{36} · running/u
    .test(document.querySelector(".productionHarness .runCard")?.textContent || ""),
  undefined, { timeout: 5_000 });
  const text = await panel.locator(".runCard").innerText();
  const runId = text.match(/Run ([0-9a-f-]{36}) · running/u)?.[1];
  if (!runId) throw new Error("Interrupted Production fixture has no running Run");
  await page.evaluate((value) => localStorage.setItem("harnessInterruptedRunId", value), runId);
  return { runId, status: "running", provider: "local-fake-only" };
}
