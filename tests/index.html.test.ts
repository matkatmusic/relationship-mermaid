import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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

async function nodeIds() {
  // Skip stub and unchosen nodes; they are not real slice nodes.
  const json = await evaluate(
    "JSON.stringify(Array.from(document.querySelectorAll('#diagram g.node')).filter(el => !el.classList.contains('stub') && !el.classList.contains('unchosen')).map(nodeIdOf).sort())"
  );
  return JSON.parse(json);
}

async function waitForNodeIds(notEqualTo: string[], timeoutMs = 3000) {
  const start = Date.now();
  let ids = await nodeIds();
  const before = JSON.stringify(notEqualTo);
  while (Date.now() - start < timeoutMs && JSON.stringify(ids) === before) {
    await sleep(50);
    ids = await nodeIds();
  }
  return ids;
}

async function labelLineHeight(id: string) {
  // One line's height, not the whole label: labels wrap to different line counts.
  const json = await evaluate(`JSON.stringify((() => {
    const p = document.querySelector('[id*="flowchart-${id}-"] .nodeLabel p');
    const range = document.createRange();
    range.selectNodeContents(p);
    return { height: range.getClientRects()[0].height, fontSize: getComputedStyle(p).fontSize };
  })())`);
  return JSON.parse(json);
}

before(async () => {
  // Scenario: start the real server and headless Chrome, then connect via CDP to drive the page like a user.
  spawnSync("bun", ["build", "viewer.ts", "--outfile", "viewer.js"], { stdio: "inherit" });
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
  // Tall viewport so the phone frame's bottom buttons aren't below the fold for elementFromPoint checks.
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:${SERVER_PORT}` });
  await waitForFunction("loadDiagram");
  // Step: on a fresh page load, the default diagram is already showing.
  const start = Date.now();
  let codeValue = await evaluate("codeBox.value");
  while (Date.now() - start < 5000 && !codeValue.includes("RAISE_ISSUE")) {
    await sleep(100);
    codeValue = await evaluate("codeBox.value");
  }
  assert.ok(codeValue.includes("RAISE_ISSUE"));
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
  // Step: the phone bar sits above the diagram, with the buttons inside it.
  const bar = await evaluate(`JSON.stringify((() => {
    const svgTop = document.querySelector('#diagram svg').getBoundingClientRect().top;
    const barBottom = document.getElementById('phoneBar').getBoundingClientRect().bottom;
    const logTop = document.getElementById('logBtn').getBoundingClientRect().top;
    const undoTop = document.getElementById('undoBtn').getBoundingClientRect().top;
    return { barAboveSvg: svgTop >= barBottom, logAboveSvg: logTop < svgTop, undoAboveSvg: undoTop < svgTop };
  })())`).then(JSON.parse);
  assert.equal(bar.barAboveSvg, true);
  assert.equal(bar.logAboveSvg, true);
  assert.equal(bar.undoAboveSvg, true);
});

const START_SLICE = ["RAISE_ISSUE", "SELF_LISTEN", "SELF_TAKE_NOTES", "Q_THEM_DONE_SPEAKING", "Q_THEM_DONE_SPEAKING_Y", "Q_THEM_DONE_SPEAKING_N"].sort();
const AFTER_Y_SLICE = ["SELF_LISTEN", "SELF_TAKE_NOTES", "Q_THEM_DONE_SPEAKING", "Q_THEM_DONE_SPEAKING_Y", "Q_ANYTHING_I_DO_NOT_UNDERSTAND", "Q_ANYTHING_I_DO_NOT_UNDERSTAND_Y", "Q_ANYTHING_I_DO_NOT_UNDERSTAND_N"].sort();
const AFTER_N_SLICE = ["RAISE_ISSUE", "SELF_LISTEN", "SELF_TAKE_NOTES", "Q_THEM_DONE_SPEAKING", "Q_THEM_DONE_SPEAKING_N"].sort();

test("test_phone_view_shows_the_start_slice", async () => {
  // Step: the rendered slice has exactly the start-slice node ids.
  const ids = await nodeIds();
  assert.deepEqual(ids, START_SLICE);
  // Step: the frame does not scroll.
  const output = await evaluate(
    "JSON.stringify({sh: document.getElementById('output').scrollHeight, ch: document.getElementById('output').clientHeight, sw: document.getElementById('output').scrollWidth, cw: document.getElementById('output').clientWidth})"
  ).then(JSON.parse);
  assert.ok(output.sh <= output.ch);
  assert.ok(output.sw <= output.cw);
  // Step: a stub line leads out of the bottom decision node.
  const stubEdge = await evaluate(
    "JSON.stringify(Array.from(document.querySelectorAll('#diagram path.flowchart-link')).some(el => el.id.includes('L_Q_THEM_DONE_SPEAKING_Y_Q_ANYTHING_I_DO_NOT_UNDERSTAND')))"
  );
  assert.equal(stubEdge, "true");
  // Step: the stub node itself is present but invisible.
  const stubNode = await evaluate(
    "JSON.stringify(!!document.querySelector('[id*=\"flowchart-Q_ANYTHING_I_DO_NOT_UNDERSTAND-\"].stub'))"
  );
  assert.equal(stubNode, "true");
  // Step: the tiny stub box does not blow up the diagram's scale.
  const widths = await evaluate(
    "JSON.stringify({svg: document.querySelector('#diagram svg').getBoundingClientRect().width, output: document.getElementById('output').getBoundingClientRect().width})"
  ).then(JSON.parse);
  assert.ok(widths.svg >= widths.output * 0.6);
  // Step: exactly one dashed separator marks the bottom decision point as pending.
  const separatorCount = await evaluate(
    "JSON.stringify(document.querySelectorAll('#diagram svg line.separator').length)"
  );
  assert.equal(separatorCount, "1");
  // Step: the edge from the bottom decision point into its stub target is dotted.
  // const dottedEdge = await evaluate(
  //   "JSON.stringify(!!Array.from(document.querySelectorAll('#diagram path.flowchart-link')).find(el => el.id.includes('L_Q_THEM_DONE_SPEAKING_Q_THEM_DONE_SPEAKING_Y_'))?.classList.contains('edge-pattern-dotted'))"
  // );
  // assert.equal(dottedEdge, "true");
  const dottedEdge = await evaluate(
    "JSON.stringify(!!Array.from(document.querySelectorAll('#diagram path.flowchart-link')).find(el => el.id.includes('L_Q_THEM_DONE_SPEAKING_Y_Q_ANYTHING_I_DO_NOT_UNDERSTAND'))?.classList.contains('edge-pattern-dotted'))"
  );
  assert.equal(dottedEdge, "true");
});

test("test_clicking_a_decision_node_slices_to_the_next_decision_point", async () => {
  // Step: click the "Yes" answer under "are they done speaking".
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  const ids = await waitForNodeIds(START_SLICE);
  // Step: the slice now centers on the clicked node and its next decision point.
  assert.deepEqual(ids, AFTER_Y_SLICE);
  // Step: a line shows where the slice came from, above the top decision point.
  const topStubEdge = await evaluate(
    "JSON.stringify(Array.from(document.querySelectorAll('#diagram path.flowchart-link')).some(el => el.id.includes('L_SELF_TAKE_NOTES_Q_THEM_DONE_SPEAKING')))"
  );
  assert.equal(topStubEdge, "true");
  // Step: that lead-in node is now shown normally, not as an invisible stub.
  const topStubNode = await evaluate(
    "JSON.stringify(!!document.querySelector('[id*=\"flowchart-SELF_TAKE_NOTES-\"].stub'))"
  );
  assert.equal(topStubNode, "false");
  // Step: a dashed separator line sits between the lead-in nodes and the top decision point.
  const separator = await evaluate(`JSON.stringify((() => {
    const line = document.querySelector('#diagram svg line.separator');
    const yOf = (el) => Number(el.getAttribute('transform').match(/translate\\([^,]+,\\s*([^)]+)\\)/)[1]);
    const leadInY = yOf(document.querySelector('[id*="flowchart-SELF_TAKE_NOTES-"]'));
    const topDpY = yOf(document.querySelector('[id*="flowchart-Q_THEM_DONE_SPEAKING-"]'));
    return { exists: !!line, y1: line && Number(line.getAttribute('y1')), leadInY, topDpY };
  })())`).then(JSON.parse);
  assert.equal(separator.exists, true);
  assert.ok(separator.y1 > separator.leadInY);
  assert.ok(separator.y1 < separator.topDpY);
  // Step: there are now two separators, one for the slice and one for the pending decision.
  const separatorCount = await evaluate(
    "JSON.stringify(document.querySelectorAll('#diagram svg line.separator').length)"
  );
  assert.equal(separatorCount, "2");
  // Step: the unchosen "No" answer shows dimmed instead of disappearing.
  const unchosenNode = await evaluate(
    "JSON.stringify(!!document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_N-\"].unchosen'))"
  );
  assert.equal(unchosenNode, "true");
  // Step: a sibling is never also a stub, so it keeps its full-size box.
  const siblingNotStub = await evaluate(
    "JSON.stringify(!document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_N-\"].stub'))"
  );
  assert.equal(siblingNotStub, "true");
  // Step: "Me: Listen" already has a real predecessor (the "No" loop-back), so RAISE_ISSUE's stub arrow is dropped.
  const raiseIssueNode = await evaluate(
    "JSON.stringify(!!document.querySelector('[id*=\"flowchart-RAISE_ISSUE-\"]'))"
  );
  assert.equal(raiseIssueNode, "false");
  // Step: the dimmed "No" answer still has a real dashed arrow into "Me: Listen".
  const noToListenEdge = await evaluate(
    "JSON.stringify(!!Array.from(document.querySelectorAll('#diagram path.flowchart-link')).find(el => el.id.includes('L_Q_THEM_DONE_SPEAKING_N_SELF_LISTEN'))?.classList.contains('edge-pattern-dotted'))"
  );
  assert.equal(noToListenEdge, "true");
  // Step: no stray dashed arrow reaches the "don't understand" question except from its real predecessor.
  const understandTargets = await evaluate(`JSON.stringify(
    Array.from(document.querySelectorAll('#diagram path.flowchart-link'))
      .map(el => el.id.match(/^L_(.+?)_Q_ANYTHING_I_DO_NOT_UNDERSTAND_\\d/))
      .filter(Boolean)
      .map(m => m[1])
  )`).then(JSON.parse);
  for (const source of understandTargets) assert.equal(source, "Q_THEM_DONE_SPEAKING_Y");
  // Step: the 8-node budget caps how many real (non-stub) nodes are shown.
  const realNodeCount = await evaluate(
    "JSON.stringify(Array.from(document.querySelectorAll('#diagram g.node')).filter(el => !el.classList.contains('stub')).length)"
  );
  assert.ok(JSON.parse(realNodeCount) <= 8);
});

test("test_reset_returns_to_the_start_slice", async () => {
  // Step: press Reset.
  await evaluate("document.getElementById('resetBtn').click()");
  const ids = await waitForNodeIds(AFTER_Y_SLICE);
  // Step: the slice is the start slice again.
  assert.deepEqual(ids, START_SLICE);
});

test("test_back_button_undoes_one_choice_at_a_time", async () => {
  // Step: click "Yes" under "done speaking", then "Yes" under "anything I don't understand".
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await waitForNodeIds(START_SLICE);
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_ANYTHING_I_DO_NOT_UNDERSTAND_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  const deeperSlice = await waitForNodeIds(AFTER_Y_SLICE);
  // Step: press Back once.
  await evaluate("document.getElementById('undoBtn').click()");
  const afterOneBack = await waitForNodeIds(deeperSlice);
  // Step: the slice returns to right after "done speaking: Yes".
  assert.deepEqual(afterOneBack, AFTER_Y_SLICE);
  // Step: press Back again.
  await evaluate("document.getElementById('undoBtn').click()");
  const afterTwoBacks = await waitForNodeIds(AFTER_Y_SLICE);
  // Step: the slice returns to the start slice.
  assert.deepEqual(afterTwoBacks, START_SLICE);
});

test("test_clicking_the_no_answer_shows_the_lead_in_nodes_and_dims_the_other_answer", async () => {
  // Step: click the "No" answer under "are they done speaking".
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_N-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  const ids = await waitForNodeIds(START_SLICE);
  // Step: the slice shows the static lead-in nodes plus the chosen decision and answer.
  assert.deepEqual(ids, AFTER_N_SLICE);
  // Step: the unchosen "Yes" answer shows dimmed.
  const unchosenNode = await evaluate(
    "JSON.stringify(!!document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_Y-\"].unchosen'))"
  );
  assert.equal(unchosenNode, "true");
});

test("test_phone_view_handles_a_diagram_with_no_edges", async () => {
  // Step: replace the code with a diagram that has no edges, while phone view is on.
  await evaluate(
    "codeBox.value = 'flowchart TD\\n  A[Only one box]'; codeBox.dispatchEvent(new Event('input'))"
  );
  await sleep(500);
  // Step: no error is shown, and the single node still renders.
  const errorText = await evaluate("document.getElementById('error').textContent");
  assert.equal(errorText, "");
  const hasNodeA = await evaluate(
    "JSON.stringify(!!document.querySelector('[id*=\"flowchart-A-\"]'))"
  );
  assert.equal(hasNodeA, "true");
  // Step: restore the accountability diagram for any tests that follow.
  await evaluate("loadDiagram('accountability.mmd')");
  await sleep(300);
});

test("test_decision_log_reflects_choices_and_undo", async () => {
  // Step: click "Yes" under "done speaking", then "Yes" under "anything I don't understand".
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await waitForNodeIds(START_SLICE);
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_ANYTHING_I_DO_NOT_UNDERSTAND_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await waitForNodeIds(AFTER_Y_SLICE);
  // Step: open the decision log.
  await evaluate("document.getElementById('logBtn').click()");
  const logAfterTwo = await evaluate("document.getElementById('logBox').textContent");
  assert.equal(
    logAfterTwo,
    "-- Decision Log for <issue> (<timestamp>) --\n" +
      "[1] in my head: are they done speaking?: Yes\n" +
      "[2] in my head: is there anything said that I don't understand?: Yes"
  );
  const isOpen = await evaluate("document.getElementById('logBox').classList.contains('open')");
  assert.equal(isOpen, true);
  // Step: the drawer reaches up into the phone frame.
  const drawerRect = await evaluate(`JSON.stringify((() => {
    const logBox = document.getElementById('logBox');
    const output = document.getElementById('output');
    const logRect = logBox.getBoundingClientRect();
    const outputRect = output.getBoundingClientRect();
    return {
      reachesUp: logRect.top < outputRect.top + 0.6 * outputRect.height,
      tallEnough: logRect.height > 100,
    };
  })())`).then(JSON.parse);
  assert.equal(drawerRect.reachesUp, true);
  assert.equal(drawerRect.tallEnough, true);
  // Step: the log button stays clickable above the open drawer.
  const btnHit = await evaluate(`JSON.stringify((() => {
    const btn = document.getElementById('logBtn');
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { insideBtn: btn === el || btn.contains(el) };
  })())`).then(JSON.parse);
  assert.equal(btnHit.insideBtn, true);
  // Step: press Back once; the log drops the most recent entry.
  await evaluate("document.getElementById('undoBtn').click()");
  await waitForNodeIds(AFTER_Y_SLICE);
  const logAfterUndo = await evaluate("document.getElementById('logBox').textContent");
  assert.equal(
    logAfterUndo,
    "-- Decision Log for <issue> (<timestamp>) --\n" +
      "[1] in my head: are they done speaking?: Yes"
  );
  // Step: press Reset; the log returns to just the header.
  await evaluate("document.getElementById('resetBtn').click()");
  await waitForNodeIds(AFTER_Y_SLICE);
  const logAfterReset = await evaluate("document.getElementById('logBox').textContent");
  assert.equal(logAfterReset, "-- Decision Log for <issue> (<timestamp>) --");
  // Step: clicking the log button again closes the drawer and reveals the diagram.
  await evaluate("document.getElementById('logBtn').click()");
  const isClosed = await evaluate("document.getElementById('logBox').classList.contains('open')");
  assert.equal(isClosed, false);
  const svgVisible = await evaluate(`JSON.stringify((() => {
    const svg = document.querySelector('#diagram svg');
    const r = svg.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.bottom - 10);
    return { insideSvg: svg === el || svg.contains(el) };
  })())`).then(JSON.parse);
  assert.equal(svgVisible.insideSvg, true);
});

test("test_font_size_is_the_same_in_every_view", async () => {
  // Step: measure one line of RAISE_ISSUE's label in the phone start slice.
  const startLabel = await labelLineHeight("RAISE_ISSUE");
  // Step: click "Yes" under "done speaking" to slice to the next decision point.
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await waitForNodeIds(START_SLICE);
  // Step: measure one line of Q_THEM_DONE_SPEAKING's label in the new phone slice.
  const afterYLabel = await labelLineHeight("Q_THEM_DONE_SPEAKING");
  // Step: the label line height stays the same across phone slices.
  assert.ok(Math.abs(afterYLabel.height - startLabel.height) < 1);
  // Step: the svg is not shrunk smaller than its set style size.
  const svgFit = await evaluate(`JSON.stringify((() => {
    const svg = document.querySelector('#diagram svg');
    return { rendered: svg.getBoundingClientRect().width, styled: parseFloat(svg.style.width) };
  })())`).then(JSON.parse);
  assert.ok(Math.abs(svgFit.rendered - svgFit.styled) < 1);
  // Step: untick phone view.
  await evaluate("document.getElementById('phoneToggle').click()");
  await sleep(300);
  // Step: measure one line of RAISE_ISSUE's label in the full web view.
  const webLabel = await labelLineHeight("RAISE_ISSUE");
  // Step: the same label line height shows in the web view as in phone view.
  assert.ok(Math.abs(webLabel.height - startLabel.height) < 1);
  // Step: re-enable phone view so later tests are unaffected.
  await evaluate("document.getElementById('phoneToggle').click()");
  await sleep(300);
});
