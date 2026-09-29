import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";
import type { FullConfig } from "@playwright/test";

export const ADMIN = { name: "Ada Admin", email: "ada@example.com", password: "correct horse battery" };
export const STORAGE = "e2e/.auth/admin.json";

/** First-run setup through the UI, once per run; every test then starts signed in as the admin. */
export default async function globalSetup(config: FullConfig) {
  const { baseURL, launchOptions } = config.projects[0]!.use;
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ baseURL });
  await page.goto("/");
  await page.getByRole("heading", { name: "Set up Vellum" }).waitFor();
  await page.getByLabel("Your name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByLabel("Workspace name").fill("Main");
  await page.getByRole("button", { name: "Create admin account" }).click();
  // A new workspace starts with setup (covered by onboarding.spec.ts); skip it here.
  await page.waitForURL("**/welcome");
  await page.getByRole("button", { name: "Skip setup" }).click();
  await page.waitForURL("**/library");
  mkdirSync(dirname(STORAGE), { recursive: true });
  await page.context().storageState({ path: STORAGE });
  await browser.close();
}
