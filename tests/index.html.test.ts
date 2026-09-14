import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
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

after(async () => {
  await fetch(`http://localhost:${SERVER_PORT}/api/diagrams/${EDITOR_FIXTURE_NAME}`, { method: "PUT", body: editorFixtureSource });
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
  const mainHeight = await evaluate("document.getElementById('main').getBoundingClientRect().height");
  assert.equal(rect.width, 450);
  assert.ok(Math.abs(rect.height - (mainHeight - 32)) < 1);
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
const AFTER_Y_SLICE = ["SELF_LISTEN", "SELF_TAKE_NOTES", "Q_THEM_DONE_SPEAKING", "Q_THEM_DONE_SPEAKING_Y", "Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID", "Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID_Y", "Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID_N"].sort();
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
    "JSON.stringify(Array.from(document.querySelectorAll('#diagram path.flowchart-link')).some(el => el.id.includes('L_Q_THEM_DONE_SPEAKING_Y_Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID')))"
  );
  assert.equal(stubEdge, "true");
  // Step: the stub node itself is present but invisible.
  const stubNode = await evaluate(
    "JSON.stringify(!!document.querySelector('[id*=\"flowchart-Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID-\"].stub'))"
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
  // Step: one label reads "open decision", and there is no last-decision mask at the start slice.
  const startLabels = await evaluate(
    "JSON.stringify(Array.from(document.querySelectorAll('#diagram svg text.separator-label')).map(el => el.textContent))"
  ).then(JSON.parse);
  assert.deepEqual(startLabels, ["open decision"]);
  const startMask = await evaluate(
    "JSON.stringify(!!document.querySelector('#diagram svg rect.last-decision-mask'))"
  );
  assert.equal(startMask, "false");
  // Step: the edge from the bottom decision point into its stub target is dotted.
  // const dottedEdge = await evaluate(
  //   "JSON.stringify(!!Array.from(document.querySelectorAll('#diagram path.flowchart-link')).find(el => el.id.includes('L_Q_THEM_DONE_SPEAKING_Q_THEM_DONE_SPEAKING_Y_'))?.classList.contains('edge-pattern-dotted'))"
  // );
  // assert.equal(dottedEdge, "true");
  const dottedEdge = await evaluate(
    "JSON.stringify(!!Array.from(document.querySelectorAll('#diagram path.flowchart-link')).find(el => el.id.includes('L_Q_THEM_DONE_SPEAKING_Y_Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID'))?.classList.contains('edge-pattern-dotted'))"
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
  // Step: there are now two separators, one for the answered decision and one for the pending one.
  const separators = await evaluate(
    "JSON.stringify({ lineCount: document.querySelectorAll('#diagram svg line.separator').length, labelTexts: Array.from(document.querySelectorAll('#diagram svg text.separator-label')).map(el => el.textContent), labelYs: Array.from(document.querySelectorAll('#diagram svg text.separator-label')).map(el => Number(el.getAttribute('y'))) })"
  ).then(JSON.parse);
  assert.equal(separators.lineCount, 2);
  assert.deepEqual([...separators.labelTexts].sort(), ["last decision", "open decision"]);
  const lastDecisionY = separators.labelYs[separators.labelTexts.indexOf("last decision")];
  const openDecisionY = separators.labelYs[separators.labelTexts.indexOf("open decision")];
  assert.ok(lastDecisionY < openDecisionY);
  // Step: a light mask covers the answered "last decision" chunk, ending before the still-open decision point.
  const mask = await evaluate(`JSON.stringify((() => {
    const rect = document.querySelector('#diagram svg rect.last-decision-mask');
    const yOf = (el) => Number(el.getAttribute('transform').match(/translate\\([^,]+,\\s*([^)]+)\\)/)[1]);
    const doneSpeakingYY = yOf(document.querySelector('[id*="flowchart-Q_THEM_DONE_SPEAKING_Y-"]'));
    const understandY = yOf(document.querySelector('[id*="flowchart-Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID-"]'));
    return {
      exists: !!rect,
      height: rect && Number(rect.getAttribute('height')),
      bottom: rect && Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')),
      doneSpeakingYY,
      understandY,
    };
  })())`).then(JSON.parse);
  assert.equal(mask.exists, true);
  assert.ok(mask.height > 0);
  assert.ok(mask.bottom > mask.doneSpeakingYY);
  assert.ok(mask.bottom < mask.understandY);
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
      .map(el => el.id.match(/^L_(.+?)_Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID_\\d/))
      .filter(Boolean)
      .map(m => m[1])
  )`).then(JSON.parse);
  for (const source of understandTargets) assert.equal(source, "Q_THEM_DONE_SPEAKING_Y");
  // Step: the 8-node budget caps how many real (non-stub) nodes are shown.
  const realNodeCount = await evaluate(
    "JSON.stringify(Array.from(document.querySelectorAll('#diagram g.node')).filter(el => !el.classList.contains('stub')).length)"
  );
  assert.ok(JSON.parse(realNodeCount) <= 8);
  // Step: clicking a sibling of the last decision point does nothing; it is no longer clickable.
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_N-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await sleep(100);
  const idsAfterSiblingClick = await nodeIds();
  assert.deepEqual(idsAfterSiblingClick, AFTER_Y_SLICE);
  const logAfterSiblingClick = await evaluate("document.getElementById('logBox').textContent");
  assert.equal(logAfterSiblingClick.split("\n").length - 1, 1);
});

test("test_reset_returns_to_the_start_slice", async () => {
  // Step: press Reset.
  await evaluate("document.getElementById('resetBtn').click()");
  const ids = await waitForNodeIds(AFTER_Y_SLICE);
  // Step: the slice is the start slice again.
  assert.deepEqual(ids, START_SLICE);
});

test("test_back_button_undoes_one_choice_at_a_time", async () => {
  // Step: click "Yes" under "done speaking", then "No" under "do I understand everything they said".
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await waitForNodeIds(START_SLICE);
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID_N-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
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
  // Step: reset so later tests start clean, since a sibling click no longer replaces the path.
  await evaluate("document.getElementById('resetBtn').click()");
  await waitForNodeIds(AFTER_N_SLICE);
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
  // Step: click "Yes" under "done speaking", then "No" under "do I understand everything they said".
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await waitForNodeIds(START_SLICE);
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID_N-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await waitForNodeIds(AFTER_Y_SLICE);
  // Step: open the decision log.
  await evaluate("document.getElementById('logBtn').click()");
  const logAfterTwo = await evaluate("document.getElementById('logBox').textContent");
  assert.equal(
    logAfterTwo,
    "-- Decision Log for <issue> (<timestamp>) --\n" +
      "[1] in my head: are they done speaking?: Yes\n" +
      "[2] Do I understand everything they said?: No"
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

test("test_clicking_a_decision_node_scrolls_the_new_choices_into_view", async () => {
  // Step: click "Yes" under "done speaking", then "No" under "do I understand everything they said".
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_THEM_DONE_SPEAKING_Y-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  await sleep(200);
  await evaluate(
    "document.querySelector('[id*=\"flowchart-Q_DO_I_UNDERSTAND_EVERYTHING_THEY_SAID_N-\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))"
  );
  const clarifySlice = await waitForNodeIds(AFTER_Y_SLICE);
  // Step: the new slice overflows the phone frame, so this test actually exercises scrolling.
  const overflow = await evaluate(
    "JSON.stringify({sh: document.getElementById('diagram').scrollHeight, ch: document.getElementById('diagram').clientHeight})"
  ).then(JSON.parse);
  assert.ok(overflow.sh > overflow.ch);
  // Step: every choice of the new bottom decision point sits fully inside the visible container.
  const fits = await evaluate(`JSON.stringify((() => {
    const container = document.getElementById('diagram').getBoundingClientRect();
    const ids = ['Q_CLARIFY_ISSUE_COUNT_NONE', 'Q_CLARIFY_ISSUE_COUNT_ONCE', 'Q_CLARIFY_ISSUE_COUNT_MULTIPLE'];
    return ids.map(id => {
      const rect = document.querySelector('[id*="flowchart-' + id + '-"]').getBoundingClientRect();
      return { id, top: rect.top, bottom: rect.bottom, containerTop: container.top, containerBottom: container.bottom };
    });
  })())`).then(JSON.parse);
  for (const choice of fits) {
    assert.ok(choice.top >= choice.containerTop, `${choice.id} top in view`);
    assert.ok(choice.bottom <= choice.containerBottom + 1, `${choice.id} bottom in view`);
  }
  // Step: press Reset; the diagram scrolls back to the top.
  await evaluate("document.getElementById('resetBtn').click()");
  await waitForNodeIds(clarifySlice);
  const scrollTop = await evaluate("JSON.stringify(document.getElementById('diagram').scrollTop)");
  assert.equal(scrollTop, "0");
});

test("test_syntax_error_keeps_last_good_diagram_and_shows_error_log", async () => {
  // Step: open the drawer if it is closed, so the editor is interactable.
  const drawerClosed = await evaluate("document.getElementById('drawer').classList.contains('closed')");
  if (drawerClosed) {
    await evaluate("document.getElementById('drawerToggle').click()");
  }
  // Step: set valid diagram text and confirm it renders.
  await evaluate(
    "codeBox.value = 'flowchart TD\\n  A[ok] --> B[good]'; codeBox.dispatchEvent(new Event('input'))"
  );
  await sleep(300);
  const hasSvg = await evaluate("!!document.querySelector('#diagram svg')");
  assert.equal(hasSvg, true);
  // Step: set broken diagram text; the last good svg stays and the error log opens.
  await evaluate(
    "codeBox.value = 'flowchart TD\\n  A[ok] --> '; codeBox.dispatchEvent(new Event('input'))"
  );
  await sleep(500);
  const stillHasSvg = await evaluate("!!document.querySelector('#diagram svg')");
  assert.equal(stillHasSvg, true);
  const hasNodeB = await evaluate('!!document.querySelector(\'[id*="flowchart-B-"]\')');
  assert.equal(hasNodeB, true);
  const errorLogOpen = await evaluate("document.getElementById('errorLog').classList.contains('open')");
  assert.equal(errorLogOpen, true);
  const errorLogText = await evaluate("document.getElementById('errorLog').textContent");
  assert.ok(errorLogText.length > 0);
  // Step: fix the diagram text; the error log closes again.
  await evaluate(
    "codeBox.value = 'flowchart TD\\n  A[ok] --> B[good]'; codeBox.dispatchEvent(new Event('input'))"
  );
  await sleep(300);
  const errorLogClosed = await evaluate("document.getElementById('errorLog').classList.contains('open')");
  assert.equal(errorLogClosed, false);
  // Step: restore the accountability diagram so later runs start clean.
  await evaluate("loadDiagram('accountability.mmd')");
  await sleep(300);
});

const EDITOR_FIXTURE_NAME = "say-something-or-let-it-go.mmd";
const editorFixtureSource = readFileSync(join(process.cwd(), "diagrams", EDITOR_FIXTURE_NAME), "utf8");

async function resetEditorFixture() {
  // Scenario: put the editor fixture back to its original bytes and load it fresh in web view.
  await fetch(`http://localhost:${SERVER_PORT}/api/diagrams/${EDITOR_FIXTURE_NAME}`, {
    method: "PUT",
    body: editorFixtureSource,
  });
  await evaluate(
    `phoneToggle.checked = false; phoneToggle.dispatchEvent(new Event('change')); loadDiagram(${JSON.stringify(EDITOR_FIXTURE_NAME)})`
  );
  await sleep(300);
}

async function selectEditorNode(id: string | null) {
  await evaluate(`window.selectEditorNode(${JSON.stringify(id)})`);
}

async function runEditorAction(name: string) {
  await evaluate(`window.${name}(); window.editorActionPromise`);
}

async function assertEditorSourceIsSavedAndValid() {
  // Scenario: the in-memory source, the file on disk, and the reloaded textarea all agree, and Mermaid accepts it.
  const source = await evaluate("codeBox.value");
  const saved = await fetch(`http://localhost:${SERVER_PORT}/api/diagrams/${EDITOR_FIXTURE_NAME}`).then((r) => r.text());
  assert.equal(saved, source);
  await evaluate(`mermaid.parse(${JSON.stringify(source)})`);
  await evaluate(`loadDiagram(${JSON.stringify(EDITOR_FIXTURE_NAME)})`);
  await sleep(300);
  const reloaded = await evaluate("codeBox.value");
  assert.equal(reloaded, source);
}

test("test_add_question_after_terminal_block_creates_two_choices", async () => {
  await resetEditorFixture();
  // Step: select the terminal block "Have the conversation" and add a question after it.
  await selectEditorNode("HaveConvo");
  await runEditorAction("addQuestionAfter");
  const source = await evaluate("codeBox.value");
  // Step: the new question is spliced in with two default choices.
  assert.ok(source.includes("HaveConvo --> Q_NEW_1"));
  assert.ok(source.includes('Q_NEW_1{"New question"}'));
  assert.ok(source.includes('Q_NEW_1_Y["Yes"]'));
  assert.ok(source.includes('Q_NEW_1_N["No"]'));
  assert.ok(source.includes("Q_NEW_1 --> Q_NEW_1_Y"));
  assert.ok(source.includes("Q_NEW_1 --> Q_NEW_1_N"));
  await assertEditorSourceIsSavedAndValid();
});

test("test_add_question_in_middle_splices_each_former_successor", async () => {
  await resetEditorFixture();
  // Step: select the start node and add a question after it.
  await selectEditorNode("Start");
  await runEditorAction("addQuestionAfter");
  const source = await evaluate("codeBox.value");
  // Step: the new question sits between Start and the former successor Q1, reached by both choices.
  assert.ok(source.includes("Start --> Q_NEW_1"));
  assert.ok(source.includes("Q_NEW_1_Y --> Q1"));
  assert.ok(source.includes("Q_NEW_1_N --> Q1"));
  assert.ok(!source.includes("Start --> Q1"));
  await assertEditorSourceIsSavedAndValid();
});

test("test_add_block_after_terminal_block", async () => {
  await resetEditorFixture();
  // Step: select the terminal block "Let it go" and add a block after it.
  await selectEditorNode("LetGo");
  await runEditorAction("addBlockAfter");
  const source = await evaluate("codeBox.value");
  // Step: the new block is appended after it.
  assert.ok(source.includes("LetGo --> B_NEW_1"));
  assert.ok(source.includes('B_NEW_1["New block"]'));
  await assertEditorSourceIsSavedAndValid();
});

test("test_add_block_in_middle_splices_the_edge", async () => {
  await resetEditorFixture();
  // Step: select the start node and add a block after it.
  await selectEditorNode("Start");
  await runEditorAction("addBlockAfter");
  const source = await evaluate("codeBox.value");
  // Step: the new block sits between Start and the former successor Q1.
  assert.ok(source.includes("Start --> B_NEW_1"));
  assert.ok(source.includes("B_NEW_1 --> Q1"));
  assert.ok(!source.includes("Start --> Q1"));
  await assertEditorSourceIsSavedAndValid();
});

test("test_remove_choice_orphans_its_downstream_path", async () => {
  await resetEditorFixture();
  // Step: normalize Q1's "No" branch into an explicit choice node.
  await selectEditorNode("Q1");
  await runEditorAction("addChoice");
  await assertEditorSourceIsSavedAndValid();
  // Step: remove that choice node; its downstream path (Let it go) is orphaned, not deleted.
  await selectEditorNode("Q1_NO");
  await runEditorAction("removeChoice");
  const source = await evaluate("codeBox.value");
  assert.ok(!source.includes("Q1_NO"));
  assert.ok(source.includes('LetGo["Let it go"]'));
  await assertEditorSourceIsSavedAndValid();
});

test("test_add_choice_normalizes_the_first_labelled_question_branch", async () => {
  await resetEditorFixture();
  // Step: select Q1 and add a choice; its first labelled branch becomes an explicit choice node.
  await selectEditorNode("Q1");
  await runEditorAction("addChoice");
  const source = await evaluate("codeBox.value");
  assert.ok(source.includes('Q1_NO["No"]'));
  assert.ok(source.includes("Q1 --> Q1_NO"));
  assert.ok(source.includes("Q1_NO --> LetGo"));
  await assertEditorSourceIsSavedAndValid();
});

test("test_inline_question_text_edit_persists", async () => {
  await resetEditorFixture();
  // Step: click the Q1 question node, type a new label into the inspector's Text input, and press Enter.
  await clickNode("Q1");
  await evaluate("(() => { const input = document.getElementById('nodeTextInput'); input.value = 'Can I stay calm?'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  await evaluate("window.editorActionPromise");
  const source = await evaluate("codeBox.value");
  // Step: the question's declaration is rewritten with brace syntax.
  assert.ok(source.includes('Q1{"Can I stay calm?"}'));
  // Step: the inspector closed after the commit.
  assert.equal((await inspectorState()).hidden, true);
  await assertEditorSourceIsSavedAndValid();
});

test("test_inline_static_block_text_edit_persists", async () => {
  await resetEditorFixture();
  // Step: click the LetGo block node, type a new label into the inspector's Text input, and press Enter.
  await clickNode("LetGo");
  await evaluate("(() => { const input = document.getElementById('nodeTextInput'); input.value = 'Pause the conversation'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  await evaluate("window.editorActionPromise");
  const source = await evaluate("codeBox.value");
  // Step: the block's declaration is rewritten with rectangle syntax.
  assert.ok(source.includes('LetGo["Pause the conversation"]'));
  await assertEditorSourceIsSavedAndValid();
});

test("test_question_removal_preview_cancel_confirm_undo_and_redo_persist", async () => {
  await resetEditorFixture();
  // Step: start removing Q1, cycle to the other candidate path, then cancel; nothing changes.
  await selectEditorNode("Q1");
  await runEditorAction("removeQuestion");
  await evaluate("document.getElementById('nextRemovalPathBtn').click()");
  await evaluate("document.getElementById('cancelRemoveQuestionBtn').click()");
  let source = await evaluate("codeBox.value");
  assert.ok(source.includes('Q1{"Can I be calm?"}'));

  // Step: remove Q1 again, cycle to the other candidate path, and confirm.
  await selectEditorNode("Q1");
  await runEditorAction("removeQuestion");
  await evaluate("document.getElementById('nextRemovalPathBtn').click()");
  await evaluate("document.getElementById('confirmRemoveQuestionBtn').click()");
  await evaluate("window.editorActionPromise");
  source = await evaluate("codeBox.value");
  // Step: Q1 is gone, and the source is saved to disk and parses cleanly.
  assert.ok(!source.includes('Q1{"Can I be calm?"}'));
  const savedAfterConfirm = await fetch(`http://localhost:${SERVER_PORT}/api/diagrams/${EDITOR_FIXTURE_NAME}`).then((r) => r.text());
  assert.equal(savedAfterConfirm, source);
  await evaluate(`mermaid.parse(${JSON.stringify(source)})`);

  // Step: undo brings Q1 back.
  await evaluate("window.undoEditorAction(); window.editorActionPromise");
  source = await evaluate("codeBox.value");
  assert.ok(source.includes('Q1{"Can I be calm?"}'));

  // Step: redo removes it again.
  await evaluate("window.redoEditorAction(); window.editorActionPromise");
  source = await evaluate("codeBox.value");
  assert.ok(!source.includes('Q1{"Can I be calm?"}'));
});

const SCROLL_FIXTURE_NAME = "accountability.mmd";
const scrollFixtureSource = readFileSync(join(process.cwd(), "diagrams", SCROLL_FIXTURE_NAME), "utf8");

async function clickNode(id: string) {
  await evaluate(`document.querySelector('[id*="flowchart-${id}-"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
}

async function dblclickNode(id: string) {
  await evaluate(`document.querySelector('[id*="flowchart-${id}-"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
}

async function inspectorState() {
  // Scenario: read the inspector's visibility, title, and Text value in one round trip.
  const json = await evaluate(`JSON.stringify({
    hidden: document.getElementById('nodeInspector').hidden,
    title: document.getElementById('nodeInspectorTitle').textContent,
    text: document.getElementById('nodeTextInput').value,
  })`);
  return JSON.parse(json);
}

async function inspectorPlacement(id: string) {
  // Scenario: where the card sits relative to the selected node and the #output box.
  const json = await evaluate(`JSON.stringify((() => {
    const card = document.getElementById('nodeInspector').getBoundingClientRect();
    const output = document.getElementById('output').getBoundingClientRect();
    const node = document.querySelector('[id*="flowchart-${id}-"]').getBoundingClientRect();
    return {
      insideOutput: card.left >= output.left && card.right <= output.right + 1 && card.top >= output.top && card.bottom <= output.bottom + 1,
      besideNode: card.left >= node.right || card.right <= node.left,
      width: card.width,
    };
  })())`);
  return JSON.parse(json);
}

async function outputScrollTop() {
  return evaluate("document.getElementById('output').scrollTop");
}

test("test_clicking_a_question_opens_a_decision_block_inspector", async () => {
  await resetEditorFixture();
  // Step: click the Q1 question node.
  await clickNode("Q1");
  // Step: the inspector is open, titled "Decision block", and holds the current label.
  const state = await inspectorState();
  assert.equal(state.hidden, false);
  assert.equal(state.title, "Decision block");
  assert.equal(state.text, "Can I be calm?");
  // Step: the card sits beside the node and inside the visible #output box.
  const placement = await inspectorPlacement("Q1");
  assert.ok(placement.width > 0);
  assert.equal(placement.insideOutput, true);
  assert.equal(placement.besideNode, true);
});

test("test_clicking_a_block_opens_a_static_block_inspector", async () => {
  await resetEditorFixture();
  // Step: click the LetGo block node.
  await clickNode("LetGo");
  // Step: the inspector is titled "static block" and holds the current label.
  const state = await inspectorState();
  assert.equal(state.hidden, false);
  assert.equal(state.title, "static block");
  assert.equal(state.text, "Let it go");
});

test("test_clicking_a_choice_opens_a_choice_block_inspector", async () => {
  await resetEditorFixture();
  // Step: give Q1 an explicit choice node, then click it.
  await selectEditorNode("Q1");
  await runEditorAction("addChoice");
  await clickNode("Q1_NO");
  // Step: the inspector is titled "choice block" and holds the current label.
  const state = await inspectorState();
  assert.equal(state.hidden, false);
  assert.equal(state.title, "choice block");
  assert.equal(state.text, "No");
});

test("test_double_clicking_a_node_focuses_and_selects_the_text_input", async () => {
  await resetEditorFixture();
  // Step: double-click the LetGo block node.
  await dblclickNode("LetGo");
  // Step: the Text input is focused and its whole value is selected.
  const focus = await evaluate(`JSON.stringify((() => {
    const input = document.getElementById('nodeTextInput');
    return { focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd, length: input.value.length };
  })())`).then(JSON.parse);
  assert.equal(focus.focused, true);
  assert.equal(focus.start, 0);
  assert.equal(focus.end, focus.length);
  assert.ok(focus.length > 0);
});

test("test_cancel_discards_uncommitted_text_and_closes_the_inspector", async () => {
  await resetEditorFixture();
  // Step: open Q1's inspector and type text without pressing Enter.
  await clickNode("Q1");
  await evaluate("document.getElementById('nodeTextInput').value = 'typed but not committed'");
  // Step: press Cancel; the inspector closes and the source is unchanged.
  await evaluate("document.getElementById('nodeInspectorDismissBtn').click()");
  assert.equal((await inspectorState()).hidden, true);
  const source = await evaluate("codeBox.value");
  assert.ok(source.includes('Q1{"Can I be calm?"}'));
  // Step: reopening Q1 shows the saved label, not the typed text.
  await clickNode("Q1");
  assert.equal((await inspectorState()).text, "Can I be calm?");
});

test("test_escape_discards_uncommitted_text_and_closes_the_inspector", async () => {
  await resetEditorFixture();
  // Step: open Q1's inspector and type text without pressing Enter.
  await clickNode("Q1");
  await evaluate("document.getElementById('nodeTextInput').value = 'typed but not committed'");
  // Step: press Escape in the input; the inspector closes and the source is unchanged.
  await evaluate("document.getElementById('nodeTextInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  assert.equal((await inspectorState()).hidden, true);
  const source = await evaluate("codeBox.value");
  assert.ok(source.includes('Q1{"Can I be calm?"}'));
});

test("test_clicking_empty_drawing_space_closes_the_inspector", async () => {
  await resetEditorFixture();
  // Step: open Q1's inspector.
  await clickNode("Q1");
  assert.equal((await inspectorState()).hidden, false);
  // Step: click the #output box itself (no node under the pointer); the inspector closes.
  await evaluate("document.getElementById('output').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  assert.equal((await inspectorState()).hidden, true);
});

test("test_clicking_another_node_retargets_the_inspector_and_discards_text", async () => {
  await resetEditorFixture();
  // Step: open Q1's inspector and type text without pressing Enter.
  await clickNode("Q1");
  await evaluate("document.getElementById('nodeTextInput').value = 'typed but not committed'");
  // Step: click LetGo; the inspector now shows LetGo and the typed text is gone.
  await clickNode("LetGo");
  const state = await inspectorState();
  assert.equal(state.hidden, false);
  assert.equal(state.title, "static block");
  assert.equal(state.text, "Let it go");
  const source = await evaluate("codeBox.value");
  assert.ok(source.includes('Q1{"Can I be calm?"}'));
});

test("test_inspector_keeps_the_diagram_scroll_position", async () => {
  // Scenario: selecting, committing with Enter, and dismissing never move #output's scroll position.
  await evaluate(`phoneToggle.checked = false; phoneToggle.dispatchEvent(new Event('change')); loadDiagram(${JSON.stringify(SCROLL_FIXTURE_NAME)})`);
  await sleep(500);
  // Step: the accountability diagram overflows #output, so scrolling is real.
  const overflow = await evaluate("JSON.stringify({sh: document.getElementById('output').scrollHeight, ch: document.getElementById('output').clientHeight})").then(JSON.parse);
  assert.ok(overflow.sh > overflow.ch);
  await evaluate("document.getElementById('output').scrollTop = 150");
  // Step: selecting a node keeps the scroll position, and the card stays inside #output.
  await clickNode("RAISE_ISSUE");
  assert.equal(await outputScrollTop(), 150);
  assert.equal((await inspectorPlacement("RAISE_ISSUE")).insideOutput, true);
  // Step: committing the text with Enter rerenders, saves, and keeps the scroll position.
  await evaluate("(() => { const input = document.getElementById('nodeTextInput'); input.value = 'Other side raises an issue'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  await evaluate("window.editorActionPromise");
  await sleep(300);
  assert.equal(await outputScrollTop(), 150);
  // Step: dismissing keeps the scroll position.
  await clickNode("RAISE_ISSUE");
  await evaluate("document.getElementById('nodeInspectorDismissBtn').click()");
  assert.equal(await outputScrollTop(), 150);
  // Step: put the accountability file back to its original bytes.
  await fetch(`http://localhost:${SERVER_PORT}/api/diagrams/${SCROLL_FIXTURE_NAME}`, { method: "PUT", body: scrollFixtureSource });
});

async function destinationState() {
  return evaluate(`JSON.stringify((() => {
    const row = document.getElementById('destinationRow');
    const select = document.getElementById('destinationSelect');
    return { hidden: row.hidden, value: select.value, dismiss: document.getElementById('nodeInspectorDismissBtn').textContent, options: Array.from(select.options).map(option => ({ value: option.value, text: option.textContent })) };
  })())`).then(JSON.parse);
}

async function setEditorSource(source: string) {
  await evaluate(`codeBox.value = ${JSON.stringify('PLACEHOLDER')}; codeBox.dispatchEvent(new Event('input'))`.replace(JSON.stringify('PLACEHOLDER'), JSON.stringify(source)));
  await sleep(300);
}

async function chooseDestination(value: string) {
  await evaluate(`(() => { const select = document.getElementById('destinationSelect'); select.value = ${JSON.stringify('PLACEHOLDER')}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`.replace(JSON.stringify('PLACEHOLDER'), JSON.stringify(value)));
  await evaluate('window.editorActionPromise');
}

async function clickInspectorAction(action: string) {
  await evaluate(`document.querySelector('[data-action="${action}"]').click()`);
  await evaluate('window.editorActionPromise');
}

async function inspectorActions() {
  return evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#nodeInspectorActions button')).map(button => ({ action: button.dataset.action, text: button.textContent, spanTwoColumns: button.classList.contains('span-2') })))`).then(JSON.parse);
}

async function inspectorFocus() {
  return evaluate(`JSON.stringify({ activeId: document.activeElement?.id, selectedId: document.getElementById('selectedNode').textContent })`).then(JSON.parse);
}

test("test_destination_lists_terminal_then_unique_static_and_decision_nodes_in_source_order", async () => {
  await resetEditorFixture();
  await setEditorSource('flowchart TD\n  Start["Start"] --> Decision{"Decide"}\n  Decision --> Decision_Y["Yes"]\n  Decision_Y --> Later["Later"]\n  Later --> Decision');
  await clickNode('Decision_Y');
  assert.deepEqual((await destinationState()).options, [
    { value: '', text: 'Terminal' },
    { value: 'new-static', text: 'New static block' },
    { value: 'new-decision', text: 'New Decision block' },
    { value: 'Start', text: 'Start (Start)' },
    { value: 'Decision', text: 'Decide (Decision)' },
    { value: 'Later', text: 'Later (Later)' },
  ]);
});

test("test_destination_is_hidden_for_decisions_and_close_tracks_terminal_static_or_choice", async () => {
  await resetEditorFixture();
  await clickNode('Q1');
  assert.equal((await destinationState()).hidden, true);
  await clickNode('LetGo');
  assert.equal((await destinationState()).dismiss, 'Close');
  await selectEditorNode('Q1');
  await runEditorAction('addChoice');
  await clickNode('Q1_NO');
  assert.equal((await destinationState()).dismiss, 'Cancel');
});

test("test_destination_replaces_an_outgoing_edge_and_keeps_the_old_path_as_an_orphan", async () => {
  await resetEditorFixture();
  await setEditorSource('flowchart TD\n  A["A"] --> B["B"]\n  B --> C["C"]\n  C --> D{"D"}');
  await clickNode('A');
  await chooseDestination('C');
  const source = await evaluate('codeBox.value');
  assert.ok(source.includes('A --> C'));
  assert.ok(!source.includes('A["A"] --> B["B"]'));
  assert.ok(source.includes('B["B"]'));
  assert.ok(source.includes('B --> C'));
  await assertEditorSourceIsSavedAndValid();
});

test("test_destination_terminal_removes_only_the_selected_outgoing_edge", async () => {
  await resetEditorFixture();
  await setEditorSource('flowchart TD\n  A["A"] --> B["B"]\n  B --> C["C"]');
  await clickNode('A');
  await chooseDestination('');
  const source = await evaluate('codeBox.value');
  assert.ok(!source.includes('A["A"] --> B["B"]'));
  assert.ok(source.includes('A["A"]'));
  assert.ok(source.includes('B["B"]'));
  assert.ok(source.includes('B --> C'));
  await clickNode('A');
  assert.equal((await destinationState()).dismiss, 'Close');
  await assertEditorSourceIsSavedAndValid();
});

test("test_destination_accepts_descendants_and_current_value_is_a_no_op", async () => {
  await resetEditorFixture();
  await setEditorSource('flowchart TD\n  A["A"] --> B["B"]\n  B --> C["C"]');
  await clickNode('A');
  const current = await evaluate('codeBox.value');
  await chooseDestination('B');
  assert.equal(await evaluate('codeBox.value'), current);
  await chooseDestination('C');
  await clickNode('C');
  await chooseDestination('A');
  assert.ok((await evaluate('codeBox.value')).includes('C --> A'));
  await assertEditorSourceIsSavedAndValid();
});

test("test_dirty_text_then_destination_creates_two_ordered_undo_entries", async () => {
  await resetEditorFixture();
  await setEditorSource('flowchart TD\n  A["A"] --> B["B"]\n  B --> C{"C"}');
  await clickNode('A');
  await evaluate("document.getElementById('nodeTextInput').value = 'Renamed A'");
  await chooseDestination('C');
  let source = await evaluate('codeBox.value');
  assert.ok(source.includes('A["Renamed A"]'));
  assert.ok(source.includes('A --> C'));
  await evaluate('window.undoEditorAction(); window.editorActionPromise');
  source = await evaluate('codeBox.value');
  assert.ok(source.includes('A["Renamed A"] --> B["B"]'));
  await evaluate('window.undoEditorAction(); window.editorActionPromise');
  source = await evaluate('codeBox.value');
  assert.ok(source.includes('A["A"] --> B["B"]'));
  await assertEditorSourceIsSavedAndValid();
});

test('test_inspector_add_after_controls_exist_only_for_static_and_choice_blocks', async () => {
  await resetEditorFixture();
  await clickNode('LetGo');
  assert.deepEqual(await inspectorActions(), [
    { action: 'remove', text: 'Remove', spanTwoColumns: false },
    { action: 'add-decision-after', text: 'add Decision block after', spanTwoColumns: false },
    { action: 'insert-static-before', text: 'insert static block before', spanTwoColumns: false },
    { action: 'insert-decision-before', text: 'insert Decision & leading choice before', spanTwoColumns: false },
  ]);
  await selectEditorNode('Q1');
  await runEditorAction('addChoice');
  await clickNode('Q1_NO');
  assert.deepEqual(await inspectorActions(), [
    { action: 'remove', text: 'Remove', spanTwoColumns: false },
    { action: 'add-decision-after', text: 'add Decision block after', spanTwoColumns: false },
    { action: 'add-static-after', text: 'add static block after', spanTwoColumns: false },
  ]);
  await clickNode('Q1');
  assert.deepEqual(await inspectorActions(), [
    { action: 'remove', text: 'Remove', spanTwoColumns: false },
    { action: 'add-choice', text: 'Add choice', spanTwoColumns: false },
    { action: 'remove-choices', text: 'Remove choices', spanTwoColumns: false },
    { action: 'insert-static-before', text: 'insert static block before', spanTwoColumns: false },
    { action: 'insert-decision-before', text: 'insert Decision & leading choice before', spanTwoColumns: false },
  ]);
});

test('test_inspector_remove_button_dispatches_removal_by_node_kind', async () => {
  await resetEditorFixture();
  // Step: Remove on a static block reconnects every predecessor to every successor.
  await clickNode('LetGo');
  await clickInspectorAction('remove');
  let source = await evaluate('codeBox.value');
  assert.ok(!source.includes('LetGo'));
  assert.equal((await inspectorState()).hidden, true);
  await assertEditorSourceIsSavedAndValid();

  // Step: Remove on an explicit choice node orphans its downstream path.
  await resetEditorFixture();
  await selectEditorNode('Q1');
  await runEditorAction('addChoice');
  await clickNode('Q1_NO');
  await clickInspectorAction('remove');
  source = await evaluate('codeBox.value');
  assert.ok(!source.includes('Q1_NO'));
  assert.ok(source.includes('LetGo["Let it go"]'));
  assert.equal((await inspectorState()).hidden, true);
  await assertEditorSourceIsSavedAndValid();

  // Step: Remove on a Decision enters the replacement-path preview instead of committing immediately.
  await resetEditorFixture();
  await clickNode('Q1');
  await clickInspectorAction('remove');
  const preview = await evaluate(`JSON.stringify({
    previewHidden: document.getElementById('nodeInspectorRemovalPreview').hidden,
    actionsHidden: document.getElementById('nodeInspectorActions').hidden,
  })`).then(JSON.parse);
  assert.equal(preview.previewHidden, false);
  assert.equal(preview.actionsHidden, true);
  await evaluate("document.getElementById('cancelRemoveQuestionBtn').click()");
  assert.equal((await inspectorState()).hidden, true);
});

test('test_inspector_remove_choices_button_orphans_every_outgoing_branch', async () => {
  await resetEditorFixture();
  // Step: normalize Q1's "No" branch into an explicit choice node, leaving "Yes" as a labelled edge.
  await selectEditorNode('Q1');
  await runEditorAction('addChoice');
  await assertEditorSourceIsSavedAndValid();
  // Step: select Q1 and use the inspector's Remove choices action.
  await clickNode('Q1');
  await clickInspectorAction('remove-choices');
  const source = await evaluate('codeBox.value');
  // Step: both branches are gone from Q1, including the explicit choice node.
  assert.ok(!source.includes('Q1 --> Q1_NO'));
  assert.ok(!source.includes('Q1_NO["No"]'));
  assert.ok(!source.includes('Q1 -- Yes --> Q2'));
  // Step: the orphaned downstream nodes remain in the source.
  assert.ok(source.includes('LetGo["Let it go"]'));
  assert.ok(source.includes('Q2{"Can they be calm?"}'));
  // Step: removing all choices closed the inspector.
  assert.equal((await inspectorState()).hidden, true);
  await assertEditorSourceIsSavedAndValid();

  // Step: an immediate choice node shared by another node's incoming edge loses that edge too, while the other node remains.
  await setEditorSource('flowchart TD\n  Q{"Q"}\n  Q --> Q_X\n  Q_X["X"]\n  Q_X --> Down["Down"]\n  Other["Other"] --> Q_X');
  await clickNode('Q');
  await clickInspectorAction('remove-choices');
  const sharedSource = await evaluate('codeBox.value');
  assert.ok(!sharedSource.includes('Q_X'));
  assert.ok(sharedSource.includes('Q{"Q"}'));
  assert.ok(sharedSource.includes('Down["Down"]'));
  assert.ok(sharedSource.includes('Other["Other"]'));
  await assertEditorSourceIsSavedAndValid();
});

test('test_new_static_button_and_destination_option_have_identical_terminal_orphan_results', async () => {
  const fixture = 'flowchart TD\n  Q{"Q"} --> Q_A["A"]\n  Q_A --> B["B"]\n  B --> C["C"]';
  await resetEditorFixture();
  await setEditorSource(fixture);
  await clickNode('Q_A');
  const buttonHistoryLength = await evaluate('editorHistory.length');
  await clickInspectorAction('add-static-after');
  const buttonSource = await evaluate('codeBox.value');
  assert.ok(buttonSource.includes('Q_A --> B_NEW_1'));
  assert.ok(buttonSource.includes('B_NEW_1["New static block"]'));
  assert.ok(!buttonSource.includes('Q_A["A"] --> B["B"]'));
  assert.ok(buttonSource.includes('B --> C["C"]'));
  assert.equal((await inspectorState()).text, 'New static block');
  assert.deepEqual(await inspectorFocus(), { activeId: 'nodeTextInput', selectedId: 'B_NEW_1' });
  assert.equal(await evaluate('editorHistory.length'), buttonHistoryLength + 1);
  await assertEditorSourceIsSavedAndValid();

  await resetEditorFixture();
  await setEditorSource(fixture);
  await clickNode('Q_A');
  const menuHistoryLength = await evaluate('editorHistory.length');
  await chooseDestination('new-static');
  assert.equal(await evaluate('codeBox.value'), buttonSource);
  assert.deepEqual(await inspectorFocus(), { activeId: 'nodeTextInput', selectedId: 'B_NEW_1' });
  assert.equal(await evaluate('editorHistory.length'), menuHistoryLength + 1);
  await assertEditorSourceIsSavedAndValid();
});

test('test_new_static_text_enter_keeps_selection_and_focuses_destination', async () => {
  await resetEditorFixture();
  await clickNode('LetGo');
  await chooseDestination('new-static');
  await evaluate(`(() => { const input = document.getElementById('nodeTextInput'); input.value = 'Follow up'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await evaluate('window.editorActionPromise');
  assert.ok((await evaluate('codeBox.value')).includes('B_NEW_1["Follow up"]'));
  assert.deepEqual(await inspectorFocus(), { activeId: 'destinationSelect', selectedId: 'B_NEW_1' });
  await assertEditorSourceIsSavedAndValid();
});

test('test_new_decision_button_and_destination_option_have_identical_source_and_initial_focus', async () => {
  const fixture = 'flowchart TD\n  A["A"] --> B["B"]\n  B --> C["C"]';
  await resetEditorFixture();
  await setEditorSource(fixture);
  await clickNode('A');
  const buttonHistoryLength = await evaluate('editorHistory.length');
  await clickInspectorAction('add-decision-after');
  const buttonSource = await evaluate('codeBox.value');
  assert.ok(buttonSource.includes('A --> Q_NEW_1'));
  assert.ok(buttonSource.includes('Q_NEW_1{"New Decision"}'));
  assert.ok(buttonSource.includes('Q_NEW_1_NEW["New choice"]'));
  assert.ok(buttonSource.includes('Q_NEW_1 --> Q_NEW_1_NEW'));
  assert.ok(!buttonSource.includes('Q_NEW_1_NEW -->'));
  assert.ok(buttonSource.includes('B --> C["C"]'));
  assert.deepEqual(await inspectorFocus(), { activeId: 'nodeTextInput', selectedId: 'Q_NEW_1' });
  assert.equal(await evaluate('editorHistory.length'), buttonHistoryLength + 1);
  await assertEditorSourceIsSavedAndValid();

  await resetEditorFixture();
  await setEditorSource(fixture);
  await clickNode('A');
  await chooseDestination('new-decision');
  assert.equal(await evaluate('codeBox.value'), buttonSource);
  assert.deepEqual(await inspectorFocus(), { activeId: 'nodeTextInput', selectedId: 'Q_NEW_1' });
  await assertEditorSourceIsSavedAndValid();
});

test('test_new_decision_text_enter_commits_then_advances_to_its_terminal_choice_destination', async () => {
  await resetEditorFixture();
  await clickNode('LetGo');
  await chooseDestination('new-decision');
  const historyBeforeText = await evaluate('editorHistory.length');
  await evaluate(`(() => { const input = document.getElementById('nodeTextInput'); input.value = 'Decide next'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await evaluate('window.editorActionPromise');
  const source = await evaluate('codeBox.value');
  assert.ok(source.includes('Q_NEW_1{"Decide next"}'));
  assert.ok(source.includes('Q_NEW_1 --> Q_NEW_1_NEW'));
  assert.ok(!source.includes('Q_NEW_1_NEW -->'));
  assert.equal((await inspectorState()).title, 'choice block');
  assert.equal((await destinationState()).value, '');
  assert.deepEqual(await inspectorFocus(), { activeId: 'destinationSelect', selectedId: 'Q_NEW_1_NEW' });
  assert.equal(await evaluate('editorHistory.length'), historyBeforeText + 1);
  await assertEditorSourceIsSavedAndValid();
});

test('test_add_choice_on_inspector_appends_a_new_terminal_choice_without_touching_existing_edges', async () => {
  await resetEditorFixture();
  await setEditorSource('flowchart TD\n  Q{"Q"} -- Yes --> Y["Y"]\n  Q --> Q_A["A"]\n  Q_A --> End["End"]');
  await clickNode('Q');
  const beforeCount = await evaluate('editorGraph().edges.filter(e => e.from === "Q").length');
  await clickInspectorAction('add-choice');
  const source = await evaluate('codeBox.value');
  // Step: a brand-new terminal choice is appended, growing Q's branch count by one.
  assert.ok(source.includes('Q_NEW["New choice"]'));
  assert.ok(source.includes('Q --> Q_NEW'));
  assert.ok(!source.includes('Q_NEW -->'));
  // Step: the existing labelled edge and the existing explicit choice are both untouched.
  assert.ok(source.includes('Q{"Q"} -- Yes --> Y["Y"]'));
  assert.ok(source.includes('Q_A["A"]'));
  assert.ok(source.includes('Q_A --> End'));
  const afterCount = await evaluate('editorGraph().edges.filter(e => e.from === "Q").length');
  assert.equal(afterCount, beforeCount + 1);
  await assertEditorSourceIsSavedAndValid();
});

test('test_add_choice_on_inspector_moves_focus_to_the_new_choices_destination', async () => {
  await resetEditorFixture();
  await setEditorSource('flowchart TD\n  Q{"Q"} -- Yes --> Y["Y"]');
  await clickNode('Q');
  const historyBefore = await evaluate('editorHistory.length');
  await clickInspectorAction('add-choice');
  // Step: the inspector now shows the new choice block, with its Destination select focused.
  const state = await inspectorState();
  assert.equal(state.hidden, false);
  assert.equal(state.title, 'choice block');
  assert.equal(state.text, 'New choice');
  assert.deepEqual(await inspectorFocus(), { activeId: 'destinationSelect', selectedId: 'Q_NEW' });
  assert.equal((await destinationState()).value, '');
  // Step: the add-choice commit is exactly one new undo entry.
  assert.equal(await evaluate('editorHistory.length'), historyBefore + 1);
  await assertEditorSourceIsSavedAndValid();
});

test('test_insert_static_block_before_splices_incoming_edges_with_their_labels', async () => {
  await resetEditorFixture();
  // Step: select the fan-in target "Let it go" and insert a static block before it.
  await clickNode('LetGo');
  const historyBefore = await evaluate('editorHistory.length');
  await clickInspectorAction('insert-static-before');
  const source = await evaluate('codeBox.value');
  // Step: the new static block is declared and sits directly before "Let it go".
  assert.ok(source.includes('B_NEW_1["New static block"]'));
  assert.ok(source.includes('B_NEW_1 --> LetGo'));
  assert.ok(source.includes('LetGo["Let it go"]'));
  // Step: every former incoming edge is redirected to the new block, keeping its own label.
  assert.ok(source.includes('Q1 -- "No" --> B_NEW_1'));
  assert.ok(source.includes('Q2 -- "No" --> B_NEW_1'));
  assert.ok(source.includes('Q3 -- "No" --> B_NEW_1'));
  assert.ok(source.includes('Q4 -- "Not helpful / Move further" --> B_NEW_1'));
  assert.ok(!source.includes('Q1 -- No --> LetGo'));
  assert.ok(!source.includes('Q2 -- No --> LetGo'));
  assert.ok(!source.includes('Q3 -- No --> LetGo'));
  assert.ok(!source.includes('Q4 -- "Not helpful / Move further" --> LetGo'));
  // Step: the insertion closed the inspector instead of opening Destination.
  assert.equal((await inspectorState()).hidden, true);
  // Step: it is a single history entry.
  assert.equal(await evaluate('editorHistory.length'), historyBefore + 1);
  // Step: undo restores the original source exactly.
  await evaluate('window.undoEditorAction(); window.editorActionPromise');
  assert.equal(await evaluate('codeBox.value'), editorFixtureSource);
  await assertEditorSourceIsSavedAndValid();
});

test('test_insert_static_block_before_a_root_node_becomes_the_new_root', async () => {
  await resetEditorFixture();
  // Step: select "Start", which has no predecessor, and insert a static block before it.
  await clickNode('Start');
  const historyBefore = await evaluate('editorHistory.length');
  await clickInspectorAction('insert-static-before');
  const source = await evaluate('codeBox.value');
  // Step: the new block leads into Start; Start keeps its own declaration untouched.
  assert.ok(source.includes('B_NEW_1["New static block"]'));
  assert.ok(source.includes('B_NEW_1 --> Start'));
  assert.ok(source.includes('Start(["Something happened.<br/>Say something, or let it go?"])'));
  assert.equal((await inspectorState()).hidden, true);
  assert.equal(await evaluate('editorHistory.length'), historyBefore + 1);
  await evaluate('window.undoEditorAction(); window.editorActionPromise');
  assert.equal(await evaluate('codeBox.value'), editorFixtureSource);
  await assertEditorSourceIsSavedAndValid();
});

test('test_insert_decision_before_adds_one_leading_choice_and_splices_incoming_edges', async () => {
  await resetEditorFixture();
  // Step: select the fan-in target "Let it go" and insert a Decision & leading choice before it.
  await clickNode('LetGo');
  const historyBefore = await evaluate('editorHistory.length');
  await clickInspectorAction('insert-decision-before');
  const source = await evaluate('codeBox.value');
  // Step: the new Decision has exactly one outgoing edge, to its new choice.
  assert.ok(source.includes('Q_NEW_1{"New Decision"}'));
  assert.ok(source.includes('Q_NEW_1_NEW["New choice"]'));
  assert.ok(source.includes('Q_NEW_1 --> Q_NEW_1_NEW'));
  const decisionOutgoing = source.match(/Q_NEW_1 -->/g) || [];
  assert.equal(decisionOutgoing.length, 1);
  // Step: the new choice leads to "Let it go", unlabelled.
  assert.ok(source.includes('Q_NEW_1_NEW --> LetGo'));
  assert.ok(source.includes('LetGo["Let it go"]'));
  // Step: every former incoming edge is redirected to the new Decision, keeping its own label.
  assert.ok(source.includes('Q1 -- "No" --> Q_NEW_1'));
  assert.ok(source.includes('Q2 -- "No" --> Q_NEW_1'));
  assert.ok(source.includes('Q3 -- "No" --> Q_NEW_1'));
  assert.ok(source.includes('Q4 -- "Not helpful / Move further" --> Q_NEW_1'));
  assert.ok(!source.includes('Q1 -- No --> LetGo'));
  // Step: the insertion closed the inspector instead of opening Destination.
  assert.equal((await inspectorState()).hidden, true);
  assert.equal(await evaluate('editorHistory.length'), historyBefore + 1);
  // Step: undo restores the original source exactly.
  await evaluate('window.undoEditorAction(); window.editorActionPromise');
  assert.equal(await evaluate('codeBox.value'), editorFixtureSource);
  await assertEditorSourceIsSavedAndValid();
});

test('test_insert_decision_before_a_root_node_becomes_the_new_root', async () => {
  await resetEditorFixture();
  // Step: select "Start", which has no predecessor, and insert a Decision & leading choice before it.
  await clickNode('Start');
  await clickInspectorAction('insert-decision-before');
  const source = await evaluate('codeBox.value');
  assert.ok(source.includes('Q_NEW_1{"New Decision"}'));
  assert.ok(source.includes('Q_NEW_1_NEW["New choice"]'));
  assert.ok(source.includes('Q_NEW_1 --> Q_NEW_1_NEW'));
  const decisionOutgoing = source.match(/Q_NEW_1 -->/g) || [];
  assert.equal(decisionOutgoing.length, 1);
  assert.ok(source.includes('Q_NEW_1_NEW --> Start'));
  assert.equal((await inspectorState()).hidden, true);
  await assertEditorSourceIsSavedAndValid();
});

test('test_all_committed_diagrams_validate_with_mermaid', async () => {
  // Step: every diagram known to the server parses cleanly with Mermaid.
  const names: string[] = await fetch(`http://localhost:${SERVER_PORT}/api/diagrams`).then((r) => r.json());
  for (const name of names) {
    const source = await fetch(`http://localhost:${SERVER_PORT}/api/diagrams/${encodeURIComponent(name)}`).then((r) => r.text());
    await evaluate(`mermaid.parse(${JSON.stringify(source)})`);
  }
});

test('test_viewer_js_build_matches_committed_bundle', async () => {
  // Step: rebuild viewer.js from viewer.ts into a fresh temp file.
  const outDir = mkdtempSync(join(tmpdir(), 'viewer-build-'));
  const outFile = join(outDir, 'viewer.js');
  spawnSync('bun', ['build', 'viewer.ts', '--outfile', outFile], { stdio: 'inherit' });
  const fresh = readFileSync(outFile, 'utf8');
  const committed = readFileSync(join(process.cwd(), 'viewer.js'), 'utf8');
  // Step: the freshly rebuilt bundle is byte-identical to the committed viewer.js.
  assert.equal(fresh, committed);
});
