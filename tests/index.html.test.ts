import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER_PORT = 3000;
const CDP_PORT = 9333;
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serverProc: ChildProcess;
let chromeProc: ChildProcess;
let ws: WebSocket;
let nextId = 1;
const pending = new Map<number, (value: any) => void>();

function send(method: string, params: Record<string, unknown> = {}) {
  return new Promise<any>((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function waitForPort(port: number, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`http://localhost:${port}`).catch(() => null);
    if (response) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`port ${port} did not open within ${timeoutMs}ms`);
}

async function evaluate(expression: string) {
  const { result } = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFunction(name: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await evaluate(`typeof ${name}`)) === "function") return;
    await sleep(50);
  }
  throw new Error(`${name} was not defined within ${timeoutMs}ms`);
}

before(async () => {
  // Scenario: start the real server and a real headless Chrome, then open a CDP connection so the test can drive the page the same way a user would.
  serverProc = spawn("bun", ["server.js"], { stdio: "ignore" });
  await waitForPort(SERVER_PORT);

  const userDataDir = mkdtempSync(join(tmpdir(), "phone-view-test-"));
  chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
  ], { stdio: "ignore" });
  await waitForPort(CDP_PORT);

  const target = await fetch(`http://localhost:${CDP_PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)!(message.result);
      pending.delete(message.id);
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://localhost:${SERVER_PORT}` });
  await waitForFunction("loadDiagram");
  await evaluate("loadDiagram('accountability.mmd')");
  await sleep(300);
});

after(() => {
  ws?.close();
  chromeProc?.kill();
  serverProc?.kill();
});

test("test_phone_view_shows_a_fixed_phone_shaped_frame", async () => {
  // Step: turn on phone view.
  await evaluate("document.getElementById('phoneToggle').click()");
  await sleep(100);
  // Step: the output frame reports a fixed phone-shaped size.
  const rect = await evaluate("JSON.stringify(document.getElementById('output').getBoundingClientRect())").then(JSON.parse);
  assert.equal(rect.width, 375);
  assert.equal(rect.height, 600);
});

test("test_phone_view_shows_only_the_first_few_boxes", async () => {
  // Step: the first box in the diagram sits inside the phone frame.
  const outputRect = await evaluate("JSON.stringify(document.getElementById('output').getBoundingClientRect())").then(JSON.parse);
  const firstBoxRect = await evaluate(
    "JSON.stringify(document.querySelector('[id*=\"flowchart-RAISE_ISSUE-\"]').getBoundingClientRect())"
  ).then(JSON.parse);
  assert.ok(firstBoxRect.top >= outputRect.top - 1);
  assert.ok(firstBoxRect.bottom <= outputRect.bottom + 1);
  // Step: a box far down the diagram sits outside the phone frame.
  const farBoxRect = await evaluate(
    "JSON.stringify(document.querySelector('[id*=\"flowchart-Q_INTERNAL_UNDERSTANDING-\"]').getBoundingClientRect())"
  ).then(JSON.parse);
  assert.ok(farBoxRect.top > outputRect.bottom);
});

test("test_clicking_an_answer_scrolls_the_next_question_into_view", async () => {
  // Step: click the "Yes" answer under "are they done speaking".
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await sleep(600);
  // Step: the next question, "is there anything I don't understand", is now inside the frame.
  const outputRect = await evaluate("JSON.stringify(document.getElementById('output').getBoundingClientRect())").then(JSON.parse);
  const nextQuestionRect = await evaluate(
    "JSON.stringify(document.querySelector('[id*=\"flowchart-Q_ANYTHING_I_DO_NOT_UNDERSTAND-\"]').getBoundingClientRect())"
  ).then(JSON.parse);
  assert.ok(nextQuestionRect.top >= outputRect.top - 1);
  assert.ok(nextQuestionRect.bottom <= outputRect.bottom + 1);
});

test("test_reset_scrolls_back_to_the_top", async () => {
  // Step: press Reset.
  await evaluate("document.getElementById('resetBtn').click()");
  await sleep(600);
  // Step: the frame is scrolled back to the top.
  const scrollTop = await evaluate("document.getElementById('output').scrollTop");
  assert.ok(scrollTop <= 1);
});
