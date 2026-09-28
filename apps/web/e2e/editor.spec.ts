import { expect, test } from "@playwright/test";

test("write in a new draft and keep it after reload", async ({ page }) => {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[browser ${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto("/");
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("main").getByRole("link", { name: "Welcome to Vellum" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Vellum");

  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "New draft" })
    .click();
  await page.getByRole("textbox", { name: "Title" }).fill("On workshops");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("## The quiet tool");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Every workshop has one tool nobody talks about.");

  await expect(page.getByTestId("word-count")).toHaveText("11 words");
  await expect(page.getByRole("heading", { name: "The quiet tool" })).toBeVisible();
  await expect(page.getByRole("complementary").getByRole("button", { name: "The quiet tool" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "On workshops" }),
  ).toBeVisible();

  // Select a word to reveal the floating toolbar.
  await page.getByText("nobody").dblclick();
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" }).click();
  await expect(page.locator(".vl-prose strong")).toHaveText("nobody");

  await expect(page.getByRole("status").filter({ hasText: /Saved|Saving|Offline/ })).toHaveText("Saved");
  const before = await page.evaluate(() =>
    JSON.stringify((window as unknown as { __titleLog?: string[] }).__titleLog ?? []),
  );
  expect(await page.getByRole("textbox", { name: "Title" }).inputValue(), before).toBe("On workshops");
  await page.reload();
  await page.waitForTimeout(1500);
  const diag = await page.evaluate(() => {
    const w = window as unknown as {
      __vellumLive?: Map<string, { doc: { getText(n: string): { toString(): string } }; saveState: string }>;
      __vellumApp?: { getState(): { documents: Array<{ id: string; title: string }> } };
    };
    const id = location.pathname.split("/").pop();
    const liveDoc = w.__vellumLive?.get(id!);
    return JSON.stringify({
      path: location.pathname,
      yTitle: liveDoc?.doc.getText("title").toString(),
      save: liveDoc?.saveState,
      liveIds: [...(w.__vellumLive?.keys() ?? [])],
      metaTitle: w.__vellumApp?.getState().documents.find((d) => d.id === id)?.title,
      textarea: (document.querySelector(".vl-title") as HTMLTextAreaElement | null)?.value,
    });
  });
  await expect(page.getByRole("textbox", { name: "Title" }), diag).toHaveValue("On workshops");
  await expect(page.locator(".vl-prose strong")).toHaveText("nobody");
});
