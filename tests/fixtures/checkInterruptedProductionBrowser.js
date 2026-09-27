async page => {
  const runId = await page.evaluate(() => localStorage.getItem("harnessInterruptedRunId"));
  if (!runId || !/^[0-9a-f-]{36}$/u.test(runId)) {
    throw new Error("Interrupted browser fixture Run identity is missing");
  }
  const base = page.url().split("/#/")[0];
  await page.goto(`${base}/#/production`);
  await page.reload();
  const guide = page.getByRole("button", { name: "跳过", exact: true });
  await guide.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await guide.isVisible()) await guide.click();
  await page.getByRole("button", { name: "受控 Run（试用）" }).click();
  const panel = page.getByRole("region", { name: "生产 Agent 持久 Run" });
  await page.waitForFunction((expected) => {
    const text = document.querySelector(".productionHarness .runCard")?.textContent || "";
    return text.includes(`Run ${expected} · waiting`)
      && text.includes("interrupted-model-call");
  }, runId, { timeout: 10_000 });
  await panel.getByRole("button", { name: "查看服务端因果证据" }).click();
  await panel.getByRole("listitem").filter({ hasText: "interrupted-model-call" }).waitFor();
  return { runId, status: "waiting", reason: "interrupted-model-call" };
}
