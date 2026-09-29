import { test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

export function anthropicSse(text: string, opts: { input?: number; output?: number } = {}): string {
  const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const chunks = text.match(/.{1,12}/gs) ?? [];
  return [
    ev("message_start", {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: opts.input ?? 20, output_tokens: 1 },
      },
    }),
    ev("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    ...chunks.map((t) =>
      ev("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: t },
      }),
    ),
    ev("content_block_stop", { type: "content_block_stop", index: 0 }),
    ev("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: opts.output ?? 10 },
    }),
    ev("message_stop", { type: "message_stop" }),
  ].join("");
}

/** Intercept Anthropic API calls. `reply` decides the text for each request body. */
export async function mockAnthropic(
  page: Page,
  reply: (body: {
    messages: Array<{ role: string; content: string }>;
    system?: string;
  }) => string | { status: number; error: { type: string; message: string }; retryAfter?: number },
  seen: Array<{ headers: Record<string, string>; body: unknown }> = [],
) {
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    const body = req.postDataJSON() as {
      messages: Array<{ role: string; content: string }>;
      system?: string;
    };
    seen.push({ headers: req.headers(), body });
    const out = reply(body);
    if (typeof out !== "string") {
      return route.fulfill({
        status: out.status,
        headers: {
          ...cors(),
          "content-type": "application/json",
          ...(out.retryAfter
            ? { "retry-after": String(out.retryAfter), "access-control-expose-headers": "retry-after" }
            : {}),
        },
        body: JSON.stringify({ type: "error", error: out.error }),
      });
    }
    return route.fulfill({
      status: 200,
      headers: { ...cors(), "content-type": "text/event-stream" },
      body: anthropicSse(out),
    });
  });
  return seen;
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "*",
  };
}

export async function addAnthropicKey(page: Page, key = "sk-ant-test-key-1234") {
  await page.goto("/settings/ai");
  await page.getByLabel("API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Test connection" }).click();
  await page.getByText(/Connected to/).waitFor();
  await page.getByRole("button", { name: "Save provider" }).click();
  await page.getByText("Configured providers").waitFor();
}

/** Select an exact piece of text in the editor (dev builds expose the editor for tests). */
export async function selectText(page: Page, text: string) {
  await page.evaluate((needle) => {
    const ed = (
      window as unknown as {
        __vellumSession: {
          getState(): {
            editor: {
              state: {
                doc: { descendants(f: (n: { isText: boolean; text?: string }, p: number) => void): void };
              };
              commands: { setTextSelection(r: { from: number; to: number }): void };
              view: { focus(): void; editable: boolean; dom: HTMLElement };
            };
          };
        };
      }
    ).__vellumSession.getState().editor;
    let from = -1;
    ed.state.doc.descendants((n, p) => {
      if (from === -1 && n.isText && n.text!.includes(needle)) from = p + n.text!.indexOf(needle);
    });
    if (from === -1) throw new Error(`text not found: ${needle}`);
    ed.commands.setTextSelection({ from, to: from + needle.length });
    ed.view.focus(); // synchronous, unlike commands.focus(), so the next keystroke lands in the editor
    // A read-only view doesn't take DOM focus from view.focus(); focus it the way a click would.
    if (!ed.view.editable) ed.view.dom.focus();
  }, text);
}

/** Create a draft from the sidebar and wait until its (empty) editor is showing. */
export async function newDraft(page: Page) {
  const before = page.url();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "New draft" })
    .click();
  await page.waitForURL((url) => url.toString() !== before && url.pathname.startsWith("/d/"));
  await page.waitForFunction(
    () => (document.querySelector(".vl-title") as HTMLTextAreaElement | null)?.value === "",
  );
}

/**
 * When a test fails, print the page's errors and visible text, so a CI failure can be read from the
 * job log without the trace.
 */
export function explainFailures() {
  const errors = new WeakMap<Page, string[]>();
  test.beforeEach(({ page }) => {
    const seen: string[] = [];
    errors.set(page, seen);
    page.on("pageerror", (e) => seen.push(`page error: ${e.stack ?? e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") seen.push(`console error: ${m.text()}`);
    });
  });
  test.afterEach(async ({ page }, info) => {
    if (info.status === info.expectedStatus) return;
    const text = await page
      .locator("body")
      .innerText({ timeout: 2000 })
      .catch(() => "(no text)");
    console.log(
      [
        `--- ${info.title} (${page.url()})`,
        ...(errors.get(page) ?? []),
        "--- page text:",
        text.slice(0, 2000),
      ].join("\n"),
    );
  });
}
