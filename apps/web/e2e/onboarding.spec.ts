import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Pretend this workspace was just created, the way setup and sign-up do. */
async function startOnboarding(page: Page) {
  await page.goto("/library");
  await page.evaluate(() =>
    localStorage.setItem("vellum:onboarding", JSON.stringify({ status: "pending", step: 0, kinds: [] })),
  );
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome$/);
}

async function renameWorkspace(page: Page, from: string, to: string) {
  await page.evaluate(
    async ([f, t]) => {
      const me = (await (await fetch("/api/auth/me")).json()) as {
        workspaces: Array<{ id: string; name: string }>;
      };
      const ws = me.workspaces.find((w) => w.name === f);
      if (!ws) return;
      await fetch(`/api/workspaces/${ws.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: t }),
      });
    },
    [from, to],
  );
}

test("a new workspace is set up step by step, and setup can be resumed", async ({ page }) => {
  const stamp = Date.now().toString(36);
  await startOnboarding(page);
  const rail = page.getByRole("list", { name: "Setup progress" });
  await expect(rail.getByRole("button", { name: /Name your workspace/ })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.getByText("Step 1 of 5")).toBeVisible();

  // 1. Name it.
  const name = page.getByLabel("Workspace name");
  await expect(name).toHaveValue("Main");
  await name.fill("Ada's studio");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "What do you write?" })).toBeVisible();

  try {
    // Leave and come back: setup resumes where you were.
    await page.goto("/library");
    await page.getByRole("button", { name: "Continue setup" }).click();
    await expect(page.getByRole("heading", { name: "What do you write?" })).toBeVisible();
    await expect(rail.getByRole("listitem").first()).toHaveAttribute("data-state", "done");

    // 2. Pick what you write: each becomes a collection.
    const cards = page.getByRole("group", { name: "What you write" });
    await cards.getByRole("button", { name: /Fiction/ }).click();
    await cards.getByRole("button", { name: /Poetry/ }).click();
    await cards.getByRole("button", { name: /Poetry/ }).click();
    await cards.getByRole("button", { name: /Newsletters/ }).click();
    await expect(cards.getByRole("button", { name: /Fiction/ })).toHaveAttribute("aria-pressed", "true");
    await expect(cards.getByRole("button", { name: /Poetry/ })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Continue" }).click();

    // 3. Import is optional.
    await expect(page.getByRole("heading", { name: "Bring in your existing work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose files" })).toBeVisible();
    await page.getByRole("button", { name: "Skip this step" }).click();

    // 4. AI is optional, and skipping it leaves a working app.
    await expect(page.getByRole("heading", { name: "Connect an AI provider" })).toBeVisible();
    await expect(page.getByText("your provider bills you directly")).toBeVisible();
    await page.getByRole("button", { name: "Add a provider key" }).click();
    await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();

    // 5. Invite someone.
    await expect(page.getByRole("heading", { name: "Invite people" })).toBeVisible();
    await page.getByLabel("Email to invite").fill(`onboard-${stamp}@example.com`);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByLabel("Invite link")).toHaveValue(/\/invite\//);

    await page.getByRole("button", { name: "Start writing" }).click();
    await expect(page).toHaveURL(/\/d\/doc_/);
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await expect(nav.getByRole("button", { name: /Ada's studio/ })).toBeVisible();
    await expect(nav.getByText("Fiction", { exact: true })).toBeVisible();
    await expect(nav.getByText("Newsletters", { exact: true })).toBeVisible();
    await expect(nav.getByText("Poetry", { exact: true })).toHaveCount(0);

    // Finished: the home page goes to the library again, with no reminder.
    await page.goto("/");
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole("button", { name: "Continue setup" })).toHaveCount(0);
  } finally {
    await renameWorkspace(page, "Ada's studio", "Main");
  }
});

test("setup can be skipped entirely", async ({ page }) => {
  await startOnboarding(page);
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("button", { name: "Continue setup" })).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: /Main/ }),
  ).toBeVisible();
});

test("on a phone the progress rail sits on top", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startOnboarding(page);
  await expect(page.getByRole("heading", { name: "Name your workspace" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page).toHaveURL(/\/library$/);
});
