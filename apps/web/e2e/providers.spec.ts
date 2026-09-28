import { expect, test } from "@playwright/test";
import { mockAnthropic } from "./fixtures.js";

test("adds an Anthropic key after a live test and never shows it again", async ({ page }) => {
  const seen = await mockAnthropic(page, (body) =>
    JSON.stringify(body).includes("sk-ant-bad") ? "unused" : "ready",
  );
  await page.goto("/settings/ai");
  await expect(page.getByText("No key, no assistant")).toBeVisible();
  await expect(page.getByText(/straight from this device to api\.anthropic\.com/)).toBeVisible();

  const save = page.getByRole("button", { name: "Save provider" });
  await expect(save).toBeDisabled();
  await page.getByLabel("API key", { exact: true }).fill("sk-ant-test-key-1234");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/Connected to claude-opus-5-5/)).toBeVisible();
  expect(seen[0]!.headers["x-api-key"]).toBe("sk-ant-test-key-1234");

  await save.click();
  await expect(page.getByText("Configured providers")).toBeVisible();
  await expect(page.getByText("Key ending")).toContainText("1234");
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("sk-ant-test-key");

  // The key is not stored in plain text anywhere in browser storage.
  const dump = await page.evaluate(async () => {
    const out: string[] = [JSON.stringify(localStorage)];
    for (const info of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(info.name!);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const name of Array.from(db.objectStoreNames)) {
        const all = await new Promise<unknown[]>((res) => {
          const r = db.transaction(name).objectStore(name).getAll();
          r.onsuccess = () => res(r.result as unknown[]);
        });
        out.push(
          JSON.stringify(all, (_k, v) => (v instanceof ArrayBuffer ? new TextDecoder().decode(v) : v)),
        );
      }
      db.close();
    }
    return out.join("\n");
  });
  expect(dump).not.toContain("sk-ant-test-key-1234");
});

test("shows a specific message when the key is rejected", async ({ page }) => {
  await mockAnthropic(page, () => ({
    status: 401,
    error: { type: "authentication_error", message: "invalid x-api-key" },
  }));
  await page.goto("/settings/ai");
  await page.getByLabel("API key", { exact: true }).fill("sk-ant-wrong-0000");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("The provider rejected your API key.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save provider" })).toBeDisabled();
});
