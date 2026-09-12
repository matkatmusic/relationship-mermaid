// viewer.ts
mermaid.initialize({ startOnLoad: false });
var codeBox = document.getElementById("code");
var diagramBox = document.getElementById("diagram");
var errorBox = document.getElementById("error");
var statusBox = document.getElementById("status");
var selectBox = document.getElementById("diagramSelect");
var drawer = document.getElementById("drawer");
var drawerToggle = document.getElementById("drawerToggle");
var openFileBtn = document.getElementById("openFileBtn");
var openFileInput = document.getElementById("openFileInput");
var outputBox = document.getElementById("output");
var phoneToggle = document.getElementById("phoneToggle");
var logBtn = document.getElementById("logBtn");
var logBox = document.getElementById("logBox");
var renderId = 0;
var currentName = null;
var watcher = null;
var chosenAnswers = new Set;
var phonePath = [];
var MAX_PHONE_NODES = 8;
var PHONE_INNER = { width: 327, height: 514 };
function viewBoxOf(svgText) {
  const match = svgText.match(/viewBox="[^"]*?\s([\d.]+)\s([\d.]+)"/);
  const [, w, h] = match;
  return { width: Number(w), height: Number(h) };
}
async function baseScale(edges) {
  const saved = phonePath.splice(0);
  const ids = sliceIds(edges);
  const source = chunkSource(new Set(ids), [], edges);
  phonePath.push(...saved);
  const { svg } = await mermaid.render("diagram-scale-" + renderId++, source);
  const box = viewBoxOf(svg);
  return Math.min(PHONE_INNER.width / box.width, PHONE_INNER.height / box.height);
}
function parentOf(id, edges) {
  let found;
  for (const edge of edges) {
    if (edge[1] === id) {
      found = edge;
      break;
    }
  }
  return found[0];
}
function labelOf(id) {
  const trimmedLines = [];
  for (const s of codeBox.value.split(`
`)) {
    trimmedLines.push(s.trim());
  }
  const shapePattern = /^[\[{(]/;
  let line;
  for (const s of trimmedLines) {
    const startsWithId = s.startsWith(id);
    const looksLikeNode = shapePattern.test(s.slice(id.length));
    const isMatch = startsWithId && looksLikeNode;
    if (isMatch) {
      line = s;
      break;
    }
  }
  if (!line)
    return id;
  const withoutId = line.slice(id.length);
  const withoutBrackets = withoutId.replace(/^[\[{(]+|[\]})]+$/g, "");
  return withoutBrackets.replace(/"/g, "");
}
function renderLog(edges) {
  const rows = [];
  for (let i = 0;i < phonePath.length; i++) {
    const id = phonePath[i];
    rows.push(`[${i + 1}] ${labelOf(parentOf(id, edges))}: ${labelOf(id)}`);
  }
  logBox.textContent = ["-- Decision Log for <issue> (<timestamp>) --", ...rows].join(`
`);
}
function sliceIds(edges) {
  const last = phonePath[phonePath.length - 1];
  const ids = last ? [parentOf(last, edges), last] : [edges[0][0]];
  let node = ids[ids.length - 1];
  for (;; ) {
    const next = [];
    for (const [from, to] of edges) {
      if (from === node)
        next.push(to);
    }
    if (next.length === 0)
      return ids;
    if (next.length > 1)
      return ids.concat(next);
    node = next[0];
    ids.push(node);
  }
}
function leadInIds(ids, siblings, edges) {
  if (!phonePath.length)
    return [];
  const budget = MAX_PHONE_NODES - new Set([...ids, ...siblings]).size;
  const found = [];
  const queue = [...ids];
  for (;; ) {
    const hasQueued = queue.length > 0;
    if (!hasQueued)
      break;
    const underBudget = found.length < budget;
    if (!underBudget)
      break;
    const node = queue.shift();
    const incoming = [];
    for (const [from, to] of edges) {
      if (to === node)
        incoming.push(from);
    }
    for (const from of incoming) {
      if (found.length >= budget)
        break;
      let outgoingCount = 0;
      for (const [f] of edges) {
        if (f === from)
          outgoingCount++;
      }
      const isStatic = !isAnswerId(from, edges) && outgoingCount <= 1;
      if (!isStatic)
        continue;
      const alreadyKept = ids.includes(from) || siblings.includes(from) || found.includes(from);
      if (alreadyKept)
        continue;
      found.push(from);
      queue.push(from);
    }
  }
  return found;
}
function siblingIds(ids, edges) {
  if (!phonePath.length)
    return [];
  const found = [];
  for (const [from, to] of edges) {
    const isFromFirst = from === ids[0];
    const isNotSecond = to !== ids[1];
    const isSibling = isFromFirst && isNotSecond;
    if (isSibling)
      found.push(to);
  }
  return found;
}
function chunkSource(shown, siblings, edges) {
  const initiallyHidden = [];
  for (const [a, b] of edges) {
    const aShown = shown.has(a);
    const bShown = shown.has(b);
    if (aShown !== bShown)
      initiallyHidden.push(aShown ? b : a);
  }
  let hidden = new Set(initiallyHidden);
  const dashed = (a, b) => siblings.includes(a) || siblings.includes(b) || hidden.has(a) || hidden.has(b);
  const hasShownPredecessor = (id) => {
    let found = false;
    for (const [from, to] of edges) {
      const matchesTarget = to === id;
      const fromShown = shown.has(from);
      const isPredecessor = matchesTarget && fromShown;
      if (isPredecessor) {
        found = true;
        break;
      }
    }
    return found;
  };
  const idOf = (line) => line.split(/[\[{(\s]/)[0];
  const lines = [];
  const keptPairs = [];
  for (const raw of codeBox.value.split(`
`)) {
    const line = raw.trim();
    const isFlowchart = line.startsWith("flowchart");
    const isClassDef = line.startsWith("classDef");
    const isFlowchartOrClassDef = isFlowchart || isClassDef;
    if (isFlowchartOrClassDef)
      lines.push(line);
    else if (line.startsWith("class ")) {
      const [, list, name] = line.split(" ");
      const kept = [];
      for (const id of list.split(",")) {
        const isShown = shown.has(id);
        const isSibling = siblings.includes(id);
        const keepId = isShown && !isSibling;
        if (keepId)
          kept.push(id);
      }
      if (kept.length)
        lines.push(`class ${kept.join(",")} ${name}`);
    } else if (line.includes("-->")) {
      const chain = [];
      for (const s of line.split("-->")) {
        chain.push(s.trim());
      }
      for (let i = 0;i + 1 < chain.length; i++) {
        const a = chain[i], b = chain[i + 1];
        const aShown = shown.has(a);
        const bShown = shown.has(b);
        const eitherShown = aShown || bShown;
        if (!eitherShown)
          continue;
        const bHasShownPredecessor = hasShownPredecessor(b);
        const dropForPredecessor = !aShown && bHasShownPredecessor;
        if (dropForPredecessor)
          continue;
        lines.push(`${a} ${dashed(a, b) ? "-.->" : "-->"} ${b}`);
        keptPairs.push([a, b]);
      }
    } else if (shown.has(idOf(line)))
      lines.push(line);
  }
  const flatPairs = keptPairs.flat();
  const notShown = [];
  for (const id of flatPairs) {
    if (!shown.has(id))
      notShown.push(id);
  }
  hidden = new Set(notShown);
  for (const id of hidden)
    lines.push(`${id}[" "]`);
  if (hidden.size) {
    lines.push("classDef stub fill:transparent,stroke:transparent,color:transparent");
    lines.push(`class ${[...hidden].join(",")} stub`);
  }
  if (siblings.length) {
    lines.push("classDef unchosen fill:#eee,stroke:#bbb,color:#999");
    lines.push(`class ${siblings.join(",")} unchosen`);
  }
  return lines.join(`
`);
}
function parseEdges(text) {
  const edges = [];
  for (const rawLine of text.split(`
`)) {
    const line = rawLine.trim();
    const isComment = line.startsWith("%%");
    const hasArrow = line.includes("-->");
    const skipLine = isComment || !hasArrow;
    if (skipLine)
      continue;
    const ids = [];
    for (const s of line.split("-->")) {
      ids.push(s.trim());
    }
    for (let i = 0;i + 1 < ids.length; i++)
      edges.push([ids[i], ids[i + 1]]);
  }
  return edges;
}
function walkTrail(edges) {
  const bright = new Set;
  const visited = new Set;
  let node = edges[0][0];
  for (;; ) {
    const hasNode = !!node;
    if (!hasNode)
      break;
    const notVisited = !visited.has(node);
    if (!notVisited)
      break;
    visited.add(node);
    bright.add(node);
    const nextNodes = [];
    for (const [from, to] of edges) {
      if (from === node)
        nextNodes.push(to);
    }
    if (nextNodes.length <= 1) {
      node = nextNodes[0];
      continue;
    }
    let chosen;
    for (const option of nextNodes) {
      if (chosenAnswers.has(option)) {
        chosen = option;
        break;
      }
    }
    node = chosen;
    if (!node)
      for (const option of nextNodes)
        bright.add(option);
  }
  return bright;
}
function highlightPath() {
  const svgNodes = diagramBox.querySelectorAll("g.node");
  const svgEdges = diagramBox.querySelectorAll("path.flowchart-link");
  const edges = parseEdges(codeBox.value);
  const bright = chosenAnswers.size ? walkTrail(edges) : null;
  const isDim = (id) => bright !== null && !bright.has(id);
  for (const el of svgNodes)
    el.classList.toggle("dim", isDim(nodeIdOf(el)));
  for (const el of svgEdges) {
    const [from, to] = edgeEndsOf(el, edges);
    el.classList.toggle("dim", isDim(from) || isDim(to));
  }
}
function edgeEndsOf(el, edges) {
  let found;
  for (const edge of edges) {
    if (el.id.includes("L_" + edge[0] + "_" + edge[1] + "_")) {
      found = edge;
      break;
    }
  }
  return found || [];
}
function nodeIdOf(el) {
  return el.id.replace(/^.*flowchart-/, "").replace(/-\d+$/, "");
}
function isAnswerId(id, edges) {
  let matched = false;
  for (const [from, to] of edges) {
    const targetsId = to === id;
    const fromIsQuestion = from.startsWith("Q_");
    const idIsAnswerOfFrom = id.startsWith(from + "_");
    const isMatch = targetsId && fromIsQuestion && idIsAnswerOfFrom;
    if (isMatch) {
      matched = true;
      break;
    }
  }
  return matched;
}
outputBox.addEventListener("click", (event) => {
  const nodeEl = event.target.closest("g.node");
  if (!nodeEl) {
    chosenAnswers.clear();
    highlightPath();
    return;
  }
  const clicked = nodeIdOf(nodeEl);
  const edges = parseEdges(codeBox.value);
  if (!isAnswerId(clicked, edges))
    return;
  if (phoneToggle.checked) {
    const last = phonePath[phonePath.length - 1];
    let sameParentAsLast = false;
    if (last) {
      sameParentAsLast = parentOf(clicked, edges) === parentOf(last, edges);
    }
    if (sameParentAsLast)
      phonePath.pop();
    phonePath.push(clicked);
    render();
    return;
  }
  if (chosenAnswers.has(clicked))
    chosenAnswers.delete(clicked);
  else
    chosenAnswers.add(clicked);
  highlightPath();
});
function drawSeparatorBetween(topId, belowIds) {
  const svg = diagramBox.querySelector("svg");
  const nodeEl = (id) => diagramBox.querySelector('[id*="flowchart-' + id + '-"]');
  const yOf = (el) => Number(el.getAttribute("transform").match(/translate\([^,]+,\s*([^)]+)\)/)[1]);
  const top = nodeEl(topId);
  const belowEls = [];
  for (const id of belowIds) {
    const el = nodeEl(id);
    if (el)
      belowEls.push(el);
  }
  const hasTopAndBelow = top && belowEls.length;
  if (!hasTopAndBelow)
    return;
  const topBottom = yOf(top) + top.getBBox().height / 2;
  const belowTops = [];
  for (const el of belowEls) {
    belowTops.push(yOf(el) - el.getBBox().height / 2);
  }
  const belowTop = Math.min(...belowTops);
  const viewBoxParts = svg.getAttribute("viewBox").split(" ");
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, , width] = viewBoxNumbers;
  const y = (topBottom + belowTop) / 2;
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x));
  line.setAttribute("x2", String(x + width));
  line.setAttribute("y1", String(y));
  line.setAttribute("y2", String(y));
  line.setAttribute("stroke", "#888");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-dasharray", "8 6");
  line.setAttribute("class", "separator");
  svg.appendChild(line);
}
function drawSeparator(ids, leadIns) {
  const svg = diagramBox.querySelector("svg");
  const nodeEl = (id) => diagramBox.querySelector('[id*="flowchart-' + id + '-"]');
  const yOf = (el) => Number(el.getAttribute("transform").match(/translate\([^,]+,\s*([^)]+)\)/)[1]);
  const topDp = nodeEl(ids[0]);
  if (!topDp)
    return;
  const topOfDp = yOf(topDp) - topDp.getBBox().height / 2;
  const leadInEls = [];
  for (const id of leadIns) {
    const el = nodeEl(id);
    if (el)
      leadInEls.push(el);
  }
  const above = [];
  for (const el of leadInEls) {
    const isAboveTop = yOf(el) + el.getBBox().height / 2 < topOfDp;
    if (isAboveTop)
      above.push(el);
  }
  if (above.length === 0)
    return;
  const aboveBottoms = [];
  for (const el of above) {
    aboveBottoms.push(yOf(el) + el.getBBox().height / 2);
  }
  const aboveBottom = Math.max(...aboveBottoms);
  const y = (aboveBottom + topOfDp) / 2;
  const viewBoxParts = svg.getAttribute("viewBox").split(" ");
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, , width] = viewBoxNumbers;
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x));
  line.setAttribute("x2", String(x + width));
  line.setAttribute("y1", String(y));
  line.setAttribute("y2", String(y));
  line.setAttribute("stroke", "#888");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-dasharray", "8 6");
  line.setAttribute("class", "separator");
  svg.appendChild(line);
}
async function render() {
  const id = "diagram-" + renderId++;
  errorBox.textContent = "";
  try {
    const edges = parseEdges(codeBox.value);
    const phone = phoneToggle.checked && edges.length > 0;
    const ids = phone ? sliceIds(edges) : [];
    const siblings = siblingIds(ids, edges);
    const leadIns = leadInIds(ids, siblings, edges);
    const shown = new Set([...ids, ...siblings, ...leadIns]);
    const reversedIds = [...ids].reverse();
    let bottomQ;
    for (const rid of reversedIds) {
      let outgoingCount = 0;
      for (const [from] of edges) {
        if (from === rid)
          outgoingCount++;
      }
      const hasBranch = outgoingCount > 1;
      if (hasBranch) {
        bottomQ = rid;
        break;
      }
    }
    const source = phone ? chunkSource(shown, siblings, edges) : codeBox.value;
    const { svg } = await mermaid.render(id, source);
    diagramBox.innerHTML = svg;
    if (edges.length > 0) {
      const scale = await baseScale(edges);
      const svgEl = diagramBox.querySelector("svg");
      const box = viewBoxOf(svg);
      svgEl.style.width = box.width * scale + "px";
      svgEl.style.height = box.height * scale + "px";
    }
    if (phone)
      renderLog(edges);
    if (phone)
      drawSeparator(ids, leadIns);
    const shouldDrawBottomSeparator = phone && bottomQ;
    if (shouldDrawBottomSeparator) {
      const bottomQTargets = [];
      for (const [from, to] of edges) {
        if (from === bottomQ)
          bottomQTargets.push(to);
      }
      drawSeparatorBetween(bottomQ, bottomQTargets);
    }
    if (!phone)
      highlightPath();
  } catch (err) {
    errorBox.textContent = err.message;
  }
}
function setStatus(text) {
  statusBox.textContent = text;
  setTimeout(() => {
    if (statusBox.textContent === text)
      statusBox.textContent = "";
  }, 2000);
}
function setDrawerOpen(open) {
  drawer.classList.toggle("closed", !open);
}
async function loadList() {
  const names = await fetch("/api/diagrams").then((r) => r.json());
  selectBox.innerHTML = '<option value="" disabled ' + (currentName ? "" : "selected") + ">Diagrams</option>";
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === currentName)
      option.selected = true;
    selectBox.appendChild(option);
  }
}
async function loadDiagram(name) {
  const text = await fetch("/api/diagrams/" + encodeURIComponent(name)).then((r) => r.text());
  currentName = name;
  codeBox.value = text;
  render();
  loadList();
  watchDiagram(name);
}
function watchDiagram(name) {
  if (watcher)
    watcher.close();
  watcher = new EventSource("/api/watch/" + encodeURIComponent(name));
  watcher.onmessage = async () => {
    codeBox.value = await fetch("/api/diagrams/" + encodeURIComponent(name)).then((r) => r.text());
    render();
  };
}
async function saveDiagram() {
  let name = currentName;
  if (!name) {
    name = prompt("Name this diagram (letters, numbers, - and _ only):");
    if (!name)
      return;
    if (!name.endsWith(".mmd"))
      name += ".mmd";
  }
  await fetch("/api/diagrams/" + encodeURIComponent(name), {
    method: "PUT",
    body: codeBox.value
  });
  currentName = name;
  setStatus("Saved " + name);
  loadList();
  watchDiagram(name);
}
document.getElementById("newBtn").addEventListener("click", () => {
  if (watcher)
    watcher.close();
  currentName = null;
  codeBox.value = `flowchart TD
  A[New idea]`;
  render();
  loadList();
  setDrawerOpen(true);
});
document.getElementById("saveBtn").addEventListener("click", saveDiagram);
document.getElementById("resetBtn").addEventListener("click", () => {
  chosenAnswers.clear();
  phonePath.length = 0;
  highlightPath();
  render();
  outputBox.scrollTo({ top: 0, behavior: "smooth" });
});
document.getElementById("undoBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  phonePath.pop();
  render();
});
logBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = logBox.classList.toggle("open");
  logBtn.textContent = open ? "Log ▼" : "Log ▲";
});
drawerToggle.addEventListener("click", () => setDrawerOpen(drawer.classList.contains("closed")));
selectBox.addEventListener("change", () => loadDiagram(selectBox.value));
phoneToggle.addEventListener("change", () => {
  outputBox.classList.toggle("phone", phoneToggle.checked);
  render();
});
openFileBtn.addEventListener("click", () => openFileInput.click());
openFileInput.addEventListener("change", async () => {
  const file = openFileInput.files[0];
  if (!file)
    return;
  if (watcher)
    watcher.close();
  currentName = null;
  codeBox.value = await file.text();
  selectBox.value = "";
  render();
  loadList();
  setDrawerOpen(true);
  openFileInput.value = "";
});
codeBox.addEventListener("input", render);
loadDiagram("accountability.mmd");
Object.assign(window, { loadDiagram, codeBox, nodeIdOf });
