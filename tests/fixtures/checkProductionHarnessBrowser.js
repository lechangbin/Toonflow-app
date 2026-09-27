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
  const productionGuide = page.getByRole("button", { name: "跳过", exact: true });
  await productionGuide.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await productionGuide.isVisible()) await productionGuide.click();
  await page.getByRole("button", { name: "受控 Run（试用）" }).click();
  const panel = page.getByRole("region", { name: "生产 Agent 持久 Run" });
  await panel.getByText("读取生产工作区 · 已开启 · 版本 1").waitFor();
  await panel.getByRole("textbox", {
    name: "描述要检查的拍摄计划、图片、派生资产、分镜或视频候选",
  }).fill("请给出只读生产建议（本地浏览器夹具）");
  await panel.getByRole("button", { name: "创建 Run" }).click();
  await page.waitForFunction(() => /Run [0-9a-f-]{36} · succeeded/u
    .test(document.querySelector(".productionHarness .runCard")?.textContent || ""),
  undefined, { timeout: 20_000 });
  const first = await panel.locator(".runCard").innerText();
  const runId = first.match(/Run ([0-9a-f-]{36}) · succeeded/u)?.[1];
  if (!runId || !first.includes("本地假模型：只读建议已完成。")) {
    throw new Error("Production browser fixture did not finish with the fake Model");
  }
  await panel.getByRole("button", { name: "查看服务端因果证据" }).click();
  await panel.getByText(/run.succeeded/u).waitFor();
  await page.reload();
  const guideAfterReload = page.getByRole("button", { name: "跳过", exact: true });
  await guideAfterReload.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await guideAfterReload.isVisible()) await guideAfterReload.click();
  await page.getByRole("button", { name: "受控 Run（试用）" }).click();
  const restored = page.getByRole("region", { name: "生产 Agent 持久 Run" });
  await restored.getByText(`Run ${runId} · succeeded`, { exact: false }).waitFor();
  return { runId, status: "succeeded", restoredAfterReload: true,
    provider: "local-fake-only" };
}
