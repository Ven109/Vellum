import { expect, test } from "@playwright/test";
import { newDraft } from "./fixtures.js";

test("focus mode hides the chrome, dims other paragraphs and tracks a sprint", async ({ page }) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Focus test");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("First paragraph here.");
  await page.keyboard.press("Enter");

  await page.keyboard.press("ControlOrMeta+Shift+F");
  const hud = page.getByRole("toolbar", { name: "Focus mode" });
  await expect(hud).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeHidden();
  await expect(page.locator(".vl-app")).toHaveAttribute("data-focus", "true");

  // Typing continues in the editor; only the current paragraph is at full strength.
  await page.keyboard.type("Second one has five words.");
  await expect(hud.getByTestId("focus-words")).toHaveText("+5 words");
  const first = page.locator(".vl-prose > p").first();
  const second = page.locator(".vl-prose > p").nth(1);
  await expect(second).toHaveClass(/vl-current-block/);
  await expect(first).toHaveCSS("opacity", "0.32");
  await expect(second).toHaveCSS("opacity", "1");

  await hud.getByRole("radio", { name: "Off" }).click();
  await expect(first).toHaveCSS("opacity", "1");

  // Sprint with pause.
  await hud.getByRole("button", { name: "Sprint" }).click();
  await hud.getByRole("button", { name: "10 min" }).click();
  await expect(hud.getByTestId("sprint-remaining")).toHaveText(/^(10:00|9:5\d)$/);
  await hud.getByRole("button", { name: "Pause sprint" }).click();
  const paused = await hud.getByTestId("sprint-remaining").textContent();
  await page.waitForTimeout(1200);
  await expect(hud.getByTestId("sprint-remaining")).toHaveText(paused!);
  await hud.getByRole("button", { name: "Resume sprint" }).click();
  await hud.getByRole("button", { name: "Stop sprint" }).click();

  // Ask opens the assistant without leaving focus.
  await hud.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  await expect(hud).toBeVisible();
  await page.getByRole("button", { name: "Close assistant" }).click();

  // Esc leaves focus mode.
  await page.locator(".vl-prose").click();
  await page.keyboard.press("Escape");
  await expect(hud).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
});
