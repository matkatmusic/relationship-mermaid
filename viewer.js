// viewer.ts
mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true });
var codeBox = document.getElementById("code");
var diagramBox = document.getElementById("diagram");
var errorBox = document.getElementById("error");
var errorLog = document.getElementById("errorLog");
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
var currentBottomQ;
var chosenAnswers = new Set;
var phonePath = [];
var MAX_PHONE_NODES = 8;
var nodeActions = document.getElementById("nodeActions");
var selectedNodeBox = document.getElementById("selectedNode");
var selectedEditorNodeId = null;
var pendingRemoval = null;
var editorHistory = [codeBox.value];
var editorHistoryIndex = 0;
var editorActionPromise;
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
  const wasPhone = outputBox.classList.contains("phone");
  outputBox.classList.add("phone");
  const screenWidth = diagramBox.clientWidth;
  const screenHeight = diagramBox.clientHeight;
  outputBox.classList.toggle("phone", wasPhone);
  return Math.min(screenWidth / box.width, screenHeight / box.height);
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
function choicesOf(id, edges) {
  const found = [];
  for (const [from, to] of edges) {
    if (from === id)
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
function setEditorActionPromise(promise) {
  editorActionPromise = promise;
  window.editorActionPromise = promise;
}
setEditorActionPromise(Promise.resolve());
function stripEditorQuotes(text) {
  return text.replace(/^"(.*)"$/, "$1");
}
function parseEditorToken(token) {
  const match = token.match(/^([A-Za-z0-9_]+)([\s\S]*)$/);
  if (!match)
    return { id: token, shape: null, label: "" };
  const id = match[1];
  const rest = match[2].trim();
  if (rest.startsWith("{") && rest.endsWith("}"))
    return { id, shape: "brace", label: stripEditorQuotes(rest.slice(1, -1)) };
  if (rest.startsWith("([") && rest.endsWith("])"))
    return { id, shape: "other", label: stripEditorQuotes(rest.slice(2, -2)) };
  if (rest.startsWith("[") && rest.endsWith("]"))
    return { id, shape: "rect", label: stripEditorQuotes(rest.slice(1, -1)) };
  return { id, shape: null, label: "" };
}
function parseEditorEdgeLine(line) {
  const labelled = line.match(/^(.+?)\s--\s(?:"([^"]*)"|(\S.*?))\s-->\s(.+)$/);
  if (labelled)
    return { fromToken: labelled[1], label: labelled[2] ?? labelled[3], toToken: labelled[4] };
  const plain = line.match(/^(.+?)\s-->\s(.+)$/);
  if (plain)
    return { fromToken: plain[1], label: undefined, toToken: plain[2] };
  return null;
}
function declarationSuffixOf(node) {
  return node.kind === "question" ? `{"${node.label}"}` : `["${node.label}"]`;
}
function editorGraph() {
  const lines = codeBox.value.split(`
`);
  const declLines = new Map;
  const edges = [];
  const recordDecl = (token, lineIndex) => {
    if (token.shape && !declLines.has(token.id))
      declLines.set(token.id, { shape: token.shape, label: token.label, lineIndex });
  };
  for (let lineIndex = 0;lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    const isSkippable = !line || line.startsWith("flowchart") || line.startsWith("classDef") || line.startsWith("class ") || line.startsWith("%%");
    if (isSkippable)
      continue;
    const edge = parseEditorEdgeLine(line);
    if (edge) {
      const from = parseEditorToken(edge.fromToken);
      const to = parseEditorToken(edge.toToken);
      recordDecl(from, lineIndex);
      recordDecl(to, lineIndex);
      edges.push({ from: from.id, to: to.id, label: edge.label, lineIndex });
    } else {
      const decl = parseEditorToken(line);
      recordDecl(decl, lineIndex);
    }
  }
  const nodes = new Map;
  for (const [id, decl] of declLines) {
    const kind = decl.shape === "brace" ? "question" : edges.some((e) => e.to === id && !e.label && id.startsWith(e.from + "_")) ? "choice" : "block";
    nodes.set(id, { id, kind, label: decl.label, lineIndex: decl.lineIndex });
  }
  return { lines, nodes, edges };
}
function editorNodeKind(id, graph) {
  return graph.nodes.get(id)?.kind;
}
function sourceWithLinesReplaced(graph, removedLineIndexes, newLines) {
  const kept = graph.lines.filter((_, lineIndex) => !removedLineIndexes.has(lineIndex));
  return [...kept, ...newLines].join(`
`);
}
function nextEditorId(prefix, graph) {
  let n = 1;
  while (graph.nodes.has(`${prefix}_${n}`))
    n++;
  return `${prefix}_${n}`;
}
function choiceId(questionId, suffix) {
  return `${questionId}_${suffix}`;
}
function preserveInlineDecl(edge, keepEndpointId, graph, newLines) {
  const node = graph.nodes.get(keepEndpointId);
  if (node && node.lineIndex === edge.lineIndex)
    newLines.push(`  ${keepEndpointId}${declarationSuffixOf(node)}`);
}
async function commitEditorSource(source, options) {
  await mermaid.parse(source);
  codeBox.value = source;
  const recordHistory = options?.recordHistory !== false;
  if (recordHistory) {
    editorHistory = editorHistory.slice(0, editorHistoryIndex + 1);
    editorHistory.push(source);
    editorHistoryIndex = editorHistory.length - 1;
  }
  await render();
  await saveDiagram();
  selectEditorNode(null);
}
function runEditorAction(action) {
  setEditorActionPromise(action());
}
function selectEditorNode(id) {
  selectedEditorNodeId = id;
  pendingRemoval = null;
  nodeActions.classList.remove("removing");
  nodeActions.classList.toggle("open", !!id);
  selectedNodeBox.textContent = id ?? "";
  renderEditorSelection();
}
function renderEditorSelection() {
  for (const el of diagramBox.querySelectorAll(".editor-selected"))
    el.classList.remove("editor-selected");
  for (const el of diagramBox.querySelectorAll(".editor-preview"))
    el.classList.remove("editor-preview");
  if (selectedEditorNodeId) {
    const el = diagramBox.querySelector('[id*="flowchart-' + selectedEditorNodeId + '-"]');
    if (el)
      el.classList.add("editor-selected");
  }
  if (pendingRemoval) {
    const target = pendingRemoval.choices[pendingRemoval.index];
    const el = diagramBox.querySelector('[id*="flowchart-' + target + '-"]');
    if (el)
      el.classList.add("editor-preview");
  }
}
function showRemovalPreview() {
  renderEditorSelection();
}
function addQuestionAfter() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = selectedEditorNodeId;
  const removedLineIndexes = new Set;
  const successors = [];
  for (const edge of graph.edges) {
    if (edge.from !== selected)
      continue;
    successors.push(edge.to);
    removedLineIndexes.add(edge.lineIndex);
  }
  const qId = nextEditorId("Q_NEW", graph);
  const yesId = choiceId(qId, "Y");
  const noId = choiceId(qId, "N");
  const newLines = [
    `  ${selected} --> ${qId}`,
    `  ${qId}{"New question"}`,
    `  ${yesId}["Yes"]`,
    `  ${noId}["No"]`,
    `  ${qId} --> ${yesId}`,
    `  ${qId} --> ${noId}`
  ];
  for (const edge of graph.edges) {
    if (edge.from !== selected)
      continue;
    preserveInlineDecl(edge, edge.to, graph, newLines);
  }
  for (const successor of successors) {
    newLines.push(`  ${yesId} --> ${successor}`);
    newLines.push(`  ${noId} --> ${successor}`);
  }
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}
function addBlockAfter() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = selectedEditorNodeId;
  const removedLineIndexes = new Set;
  const successors = [];
  const newLines = [];
  for (const edge of graph.edges) {
    if (edge.from !== selected)
      continue;
    successors.push(edge.to);
    removedLineIndexes.add(edge.lineIndex);
    preserveInlineDecl(edge, edge.to, graph, newLines);
  }
  const bId = nextEditorId("B_NEW", graph);
  newLines.unshift(`  ${selected} --> ${bId}`, `  ${bId}["New block"]`);
  for (const successor of successors)
    newLines.push(`  ${bId} --> ${successor}`);
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}
function choiceSuffixFromLabel(label) {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "CHOICE";
}
function addChoice() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = selectedEditorNodeId;
  const labelled = graph.edges.find((e) => e.from === questionId && e.label);
  const removedLineIndexes = new Set;
  const newLines = [];
  if (labelled) {
    removedLineIndexes.add(labelled.lineIndex);
    const suffix = choiceSuffixFromLabel(labelled.label);
    const cid = choiceId(questionId, suffix);
    const targetSuffix = (() => {
      const node = graph.nodes.get(labelled.to);
      return node && node.lineIndex === labelled.lineIndex ? declarationSuffixOf(node) : "";
    })();
    newLines.push(`  ${cid}["${labelled.label}"]`, `  ${questionId} --> ${cid}`, `  ${cid} --> ${labelled.to}${targetSuffix}`);
  } else {
    let suffix = "NEW";
    let n = 1;
    while (graph.nodes.has(choiceId(questionId, suffix)))
      suffix = "NEW" + ++n;
    const cid = choiceId(questionId, suffix);
    newLines.push(`  ${cid}["New choice"]`, `  ${questionId} --> ${cid}`);
  }
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}
function removeChoice() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const id = selectedEditorNodeId;
  const node = graph.nodes.get(id);
  const removedLineIndexes = new Set;
  const newLines = [];
  if (node)
    removedLineIndexes.add(node.lineIndex);
  for (const edge of graph.edges) {
    const touchesRemoved = edge.from === id || edge.to === id;
    if (!touchesRemoved)
      continue;
    removedLineIndexes.add(edge.lineIndex);
    const otherEndpoint = edge.from === id ? edge.to : edge.from;
    if (otherEndpoint !== id)
      preserveInlineDecl(edge, otherEndpoint, graph, newLines);
  }
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}
function removeBlock() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const id = selectedEditorNodeId;
  const node = graph.nodes.get(id);
  const removedLineIndexes = new Set;
  const newLines = [];
  const predecessors = [];
  const successors = [];
  if (node)
    removedLineIndexes.add(node.lineIndex);
  for (const edge of graph.edges) {
    const touchesRemoved = edge.from === id || edge.to === id;
    if (!touchesRemoved)
      continue;
    removedLineIndexes.add(edge.lineIndex);
    if (edge.from === id) {
      successors.push(edge.to);
      preserveInlineDecl(edge, edge.to, graph, newLines);
    } else {
      predecessors.push(edge.from);
      preserveInlineDecl(edge, edge.from, graph, newLines);
    }
  }
  for (const predecessor of predecessors)
    for (const successor of successors)
      newLines.push(`  ${predecessor} --> ${successor}`);
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}
function removeQuestion() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = selectedEditorNodeId;
  const choices = [];
  for (const edge of graph.edges) {
    if (edge.from === questionId)
      choices.push(edge.to);
  }
  if (!choices.length)
    return;
  pendingRemoval = { questionId, choices, index: 0 };
  nodeActions.classList.add("removing");
  showRemovalPreview();
}
function advanceRemovalPreview() {
  if (!pendingRemoval)
    return;
  pendingRemoval.index = (pendingRemoval.index + 1) % pendingRemoval.choices.length;
  showRemovalPreview();
}
function cancelQuestionRemoval() {
  selectEditorNode(null);
}
function confirmQuestionRemoval() {
  if (!pendingRemoval)
    return;
  const { questionId, choices, index } = pendingRemoval;
  const graph = editorGraph();
  const removedLineIndexes = new Set;
  const newLines = [];
  const qNode = graph.nodes.get(questionId);
  if (qNode)
    removedLineIndexes.add(qNode.lineIndex);
  const predecessors = [];
  for (const edge of graph.edges) {
    if (edge.to !== questionId)
      continue;
    predecessors.push(edge.from);
    removedLineIndexes.add(edge.lineIndex);
    preserveInlineDecl(edge, edge.from, graph, newLines);
  }
  let keepSuccessor = choices[index];
  for (const edge of graph.edges) {
    if (edge.from !== questionId)
      continue;
    removedLineIndexes.add(edge.lineIndex);
    const targetNode = graph.nodes.get(edge.to);
    const isImmediateChoice = targetNode?.kind === "choice";
    if (!isImmediateChoice) {
      preserveInlineDecl(edge, edge.to, graph, newLines);
      continue;
    }
    removedLineIndexes.add(targetNode.lineIndex);
    for (const inner of graph.edges) {
      if (inner.from !== edge.to)
        continue;
      removedLineIndexes.add(inner.lineIndex);
      if (edge.to === keepSuccessor) {
        preserveInlineDecl(inner, inner.to, graph, newLines);
        keepSuccessor = inner.to;
      }
    }
  }
  for (const predecessor of predecessors)
    newLines.push(`  ${predecessor} --> ${keepSuccessor}`);
  runEditorAction(() => commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}
function undoEditorAction() {
  if (editorHistoryIndex <= 0)
    return;
  editorHistoryIndex--;
  runEditorAction(() => commitEditorSource(editorHistory[editorHistoryIndex], { recordHistory: false }));
}
function redoEditorAction() {
  if (editorHistoryIndex >= editorHistory.length - 1)
    return;
  editorHistoryIndex++;
  runEditorAction(() => commitEditorSource(editorHistory[editorHistoryIndex], { recordHistory: false }));
}
function replaceDeclarationInLine(line, id, newToken) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedId}(\\{[^}]*\\}|\\[[^\\]]*\\]|\\(\\[[^\\]]*\\]\\))`);
  return line.replace(re, newToken);
}
function beginInlineEdit(nodeEl, id, kind) {
  const label = nodeEl.querySelector(".nodeLabel");
  if (!label)
    return;
  label.contentEditable = "true";
  label.focus();
  let committed = false;
  const commit = () => {
    if (committed)
      return;
    committed = true;
    label.contentEditable = "false";
    const text = (label.textContent ?? "").trim();
    const graph = editorGraph();
    const node = graph.nodes.get(id);
    if (!node)
      return;
    const newToken = kind === "question" ? `${id}{"${text}"}` : `${id}["${text}"]`;
    const lines = graph.lines.slice();
    lines[node.lineIndex] = replaceDeclarationInLine(lines[node.lineIndex], id, newToken);
    runEditorAction(() => commitEditorSource(lines.join(`
`)));
  };
  label.addEventListener("keydown", (event) => {
    if (event.key !== "Enter")
      return;
    event.preventDefault();
    commit();
  });
  label.addEventListener("blur", commit, { once: true });
}
outputBox.addEventListener("click", (event) => {
  const nodeEl = event.target.closest("g.node");
  if (!phoneToggle.checked) {
    selectEditorNode(nodeEl ? nodeIdOf(nodeEl) : null);
    return;
  }
  if (!nodeEl)
    return;
  const clicked = nodeIdOf(nodeEl);
  const edges = parseEdges(codeBox.value);
  if (!isAnswerId(clicked, edges))
    return;
  const openChoices = currentBottomQ ? choicesOf(currentBottomQ, edges) : [];
  if (!openChoices.includes(clicked))
    return;
  phonePath.push(clicked);
  render();
});
outputBox.addEventListener("dblclick", (event) => {
  if (phoneToggle.checked)
    return;
  const nodeEl = event.target.closest("g.node");
  if (!nodeEl)
    return;
  const id = nodeIdOf(nodeEl);
  const graph = editorGraph();
  const kind = editorNodeKind(id, graph);
  if (!kind || kind === "choice")
    return;
  beginInlineEdit(nodeEl, id, kind);
});
document.getElementById("addQuestionAfterBtn").addEventListener("click", addQuestionAfter);
document.getElementById("addBlockAfterBtn").addEventListener("click", addBlockAfter);
document.getElementById("removeQuestionBtn").addEventListener("click", removeQuestion);
document.getElementById("removeBlockBtn").addEventListener("click", removeBlock);
document.getElementById("addChoiceBtn").addEventListener("click", addChoice);
document.getElementById("removeChoiceBtn").addEventListener("click", removeChoice);
document.getElementById("nextRemovalPathBtn").addEventListener("click", advanceRemovalPreview);
document.getElementById("confirmRemoveQuestionBtn").addEventListener("click", confirmQuestionRemoval);
document.getElementById("cancelRemoveQuestionBtn").addEventListener("click", cancelQuestionRemoval);
document.getElementById("editorUndoBtn").addEventListener("click", undoEditorAction);
document.getElementById("editorRedoBtn").addEventListener("click", redoEditorAction);
function drawSeparatorBetween(topId, belowIds, label) {
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
  const lineAttrs = [
    ["x1", String(x - 1e4)],
    ["x2", String(x + width + 1e4)],
    ["y1", String(y)],
    ["y2", String(y)],
    ["stroke", "#888"],
    ["stroke-width", "2"],
    ["stroke-dasharray", "8 6"]
  ];
  for (const [name, value] of lineAttrs) {
    line.setAttribute(name, value);
  }
  line.setAttribute("class", "separator");
  svg.appendChild(line);
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const screenToSvg = svg.getScreenCTM().inverse();
  const svgLeft = new DOMPoint(svg.getBoundingClientRect().left, 0).matrixTransform(screenToSvg).x;
  text.setAttribute("x", String(svgLeft + 8));
  text.setAttribute("y", String(y - 6));
  const isOpenDecision = label === "open decision";
  const fill = isOpenDecision ? "#2e7d32" : "#c62828";
  text.setAttribute("fill", fill);
  text.setAttribute("stroke", "#000");
  text.setAttribute("stroke-width", "0.6");
  text.setAttribute("paint-order", "stroke");
  text.setAttribute("font-weight", "bold");
  text.setAttribute("font-size", "16");
  text.setAttribute("font-family", "sans-serif");
  text.setAttribute("class", "separator-label");
  text.textContent = label;
  svg.appendChild(text);
}
function drawLastDecisionMask(ids, edges) {
  const svg = diagramBox.querySelector("svg");
  const nodeEl = (id) => diagramBox.querySelector('[id*="flowchart-' + id + '-"]');
  const yOf = (el) => Number(el.getAttribute("transform").match(/translate\([^,]+,\s*([^)]+)\)/)[1]);
  const top = nodeEl(ids[0]);
  const choiceEls = [];
  for (const id of choicesOf(ids[0], edges)) {
    const el = nodeEl(id);
    if (el)
      choiceEls.push(el);
  }
  const hasTopAndChoices = top && choiceEls.length;
  if (!hasTopAndChoices)
    return;
  const bottoms = [];
  for (const el of choiceEls) {
    bottoms.push(yOf(el) + el.getBBox().height / 2);
  }
  const maskBottom = Math.max(...bottoms) + 12;
  const viewBoxParts = svg.getAttribute("viewBox").split(" ");
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, y, width] = viewBoxNumbers;
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x - 1e4));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(width + 20000));
  rect.setAttribute("height", String(maskBottom - y));
  rect.setAttribute("fill", "rgba(0,0,0,0.25)");
  rect.setAttribute("class", "last-decision-mask");
  rect.setAttribute("pointer-events", "none");
  svg.appendChild(rect);
}
function scrollChoicesIntoView(bottomQ, edges) {
  const atStart = phonePath.length === 0;
  if (atStart) {
    diagramBox.scrollTop = 0;
    return;
  }
  if (!bottomQ)
    return;
  let lastChoice = null;
  for (const [from, to] of edges) {
    const isChoice = from === bottomQ;
    if (isChoice)
      lastChoice = diagramBox.querySelector('[id*="flowchart-' + to + '-"]');
  }
  if (!lastChoice)
    return;
  lastChoice.scrollIntoView({ block: "end" });
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
    currentBottomQ = bottomQ;
    const source = phone ? chunkSource(shown, siblings, edges) : codeBox.value;
    const { svg } = await mermaid.render(id, source);
    diagramBox.innerHTML = svg;
    renderEditorSelection();
    if (edges.length > 0) {
      const scale = await baseScale(edges);
      const svgEl = diagramBox.querySelector("svg");
      const box = viewBoxOf(svg);
      const phoneWidth = phone ? Math.max(box.width * scale, diagramBox.clientWidth) : box.width * scale;
      svgEl.style.width = phoneWidth + "px";
      svgEl.style.height = box.height * scale + "px";
    }
    if (phone)
      renderLog(edges);
    const shouldDrawLastDecision = phone && phonePath.length > 0;
    if (shouldDrawLastDecision)
      drawLastDecisionMask(ids, edges);
    if (shouldDrawLastDecision)
      drawSeparatorBetween(ids[0], choicesOf(ids[0], edges), "last decision");
    const shouldDrawBottomSeparator = phone && bottomQ;
    if (shouldDrawBottomSeparator)
      drawSeparatorBetween(bottomQ, choicesOf(bottomQ, edges), "open decision");
    if (phone)
      scrollChoicesIntoView(bottomQ, edges);
    if (!phone)
      highlightPath();
    errorLog.textContent = "";
    errorLog.classList.remove("open");
  } catch (err) {
    errorBox.textContent = err.message;
    errorLog.textContent += err.message + `
`;
    errorLog.classList.add("open");
    errorLog.scrollTop = errorLog.scrollHeight;
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
function resetEditorHistory(text) {
  editorHistory = [text];
  editorHistoryIndex = 0;
  selectEditorNode(null);
}
async function loadDiagram(name) {
  const text = await fetch("/api/diagrams/" + encodeURIComponent(name)).then((r) => r.text());
  currentName = name;
  codeBox.value = text;
  resetEditorHistory(text);
  render();
  loadList();
  watchDiagram(name);
}
function watchDiagram(name) {
  if (watcher)
    watcher.close();
  const source = new EventSource("/api/watch/" + encodeURIComponent(name));
  watcher = source;
  source.onmessage = async () => {
    const text = await fetch("/api/diagrams/" + encodeURIComponent(name)).then((r) => r.text());
    const isStaleWatcher = watcher !== source;
    if (isStaleWatcher)
      return;
    if (text !== codeBox.value) {
      codeBox.value = text;
      resetEditorHistory(text);
    }
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
  resetEditorHistory(codeBox.value);
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
  if (phoneToggle.checked)
    selectEditorNode(null);
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
  resetEditorHistory(codeBox.value);
  selectBox.value = "";
  render();
  loadList();
  setDrawerOpen(true);
  openFileInput.value = "";
});
codeBox.addEventListener("input", () => {
  resetEditorHistory(codeBox.value);
  render();
});
loadDiagram("accountability.mmd");
Object.assign(window, { loadDiagram, codeBox, nodeIdOf, selectEditorNode, addQuestionAfter, addBlockAfter, removeQuestion, removeBlock, addChoice, removeChoice, undoEditorAction, redoEditorAction });
