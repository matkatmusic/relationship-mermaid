// dom.ts
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
var mainBox = document.getElementById("main");
var outputBox = document.getElementById("output");
var phoneDiagramBox = document.getElementById("phoneDiagram");
var logBtn = document.getElementById("logBtn");
var logBox = document.getElementById("logBox");
var previousDecisionBtn = document.getElementById("previousDecisionBtn");
var nextDecisionBtn = document.getElementById("nextDecisionBtn");
var decisionCounter = document.getElementById("decisionCounter");
var zoomInBtn = document.getElementById("zoomInBtn");
var zoomOutBtn = document.getElementById("zoomOutBtn");
var zoomResetBtn = document.getElementById("zoomResetBtn");
var zoomLevel = document.getElementById("zoomLevel");
var nodeActions = document.getElementById("nodeActions");
var selectedNodeBox = document.getElementById("selectedNode");
var nodeInspector = document.getElementById("nodeInspector");
var nodeInspectorTitle = document.getElementById("nodeInspectorTitle");
var nodeTextInput = document.getElementById("nodeTextInput");
var nodeTypeRow = document.getElementById("nodeTypeRow");
var nodeTypeInput = document.getElementById("nodeTypeInput");
var nodeTypeColorRow = document.getElementById("nodeTypeColorRow");
var nodeTypeColorInput = document.getElementById("nodeTypeColorInput");
var nodeInspectorDismissBtn = document.getElementById("nodeInspectorDismissBtn");
var destinationRow = document.getElementById("destinationRow");
var destinationSelect = document.getElementById("destinationSelect");
var nodeInspectorActions = document.getElementById("nodeInspectorActions");
var nodeInspectorControls = document.getElementById("nodeInspectorControls");
var nodeInspectorRemovalPreview = document.getElementById("nodeInspectorRemovalPreview");

// state.ts
var MAIN_ZOOM_STEP = 10;
var MIN_MAIN_ZOOM = 20;
var MAX_MAIN_ZOOM = 400;
var chosenAnswers = new Set;
var phonePath = [];
var MAX_PHONE_NODES = 8;
var NEW_STATIC_DESTINATION = "new-static";
var NEW_DECISION_DESTINATION = "new-decision";
var DEFAULT_TYPE_COLORS = {
  decision: "#f6d365",
  choice: "#9ed7a4",
  static: "#9fc5e8",
  goal: "#c9b6e4"
};
var state = {
  renderId: 0,
  currentName: null,
  watcher: null,
  currentBottomQ: undefined,
  phoneFocusNodeId: null,
  phoneFocusUsesDecisionContext: false,
  phonePreviewChoiceId: null,
  diagramScale: null,
  mainZoomPercent: 100,
  selectedEditorNodeId: null,
  currentDecisionId: null,
  advanceAfterDecisionText: null,
  focusDestinationAfterTextId: null,
  pendingRemoval: null,
  editorHistory: [codeBox.value],
  editorHistoryIndex: 0,
  editorActionPromise: undefined,
  editSeq: 0,
  typeColors: { ...DEFAULT_TYPE_COLORS },
  nodeTypes: {}
};
for (const key of Object.keys(state)) {
  Object.defineProperty(globalThis, key, {
    get: () => state[key],
    set: (value) => {
      state[key] = value;
    },
    configurable: true
  });
}

// diagram-source.ts
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

// render-helpers.ts
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
    const idIsAnswerOfFrom = id.startsWith("Q_CHOICE_" + from.replace(/^Q_/, "") + "_");
    const isMatch = targetsId && fromIsQuestion && idIsAnswerOfFrom;
    if (isMatch) {
      matched = true;
      break;
    }
  }
  return matched;
}
function showEditorValidationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  errorBox.textContent = message;
  errorLog.textContent = message + `
`;
  errorLog.classList.add("open");
  errorLog.scrollTop = errorLog.scrollHeight;
}

// editor-types.ts
var INSPECTOR_TITLES = { question: "Decision block", block: "static block", choice: "choice block" };

class EditorValidationError extends Error {
  problems;
  constructor(problems) {
    super(`Invalid diagram:
${problems.join(`
`)}`);
    this.problems = problems;
    this.name = "EditorValidationError";
  }
}
var EDITOR_METADATA_FENCE = "%%%%====";
var EDITOR_METADATA_WARNING = "DO NOT MODIFY - AUTOMATICALLY GENERATED DURING EVERY SAVE";

// editor-graph.ts
function splitEditorMetadata(source) {
  const headerPattern = /(?:^|\r?\n)%%%%====\r?\n%% DO NOT MODIFY - AUTOMATICALLY GENERATED DURING EVERY SAVE\r?\n%% (\{[^\r\n]*\})\r?\n%%%%====/g;
  const matches = [...source.matchAll(headerPattern)];
  if (matches.length === 0)
    return { source, metadata: null };
  let metadata = null;
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1]);
    if (parsed && typeof parsed === "object") {
      const lastSelectedNodeId = typeof parsed.lastSelectedNodeId === "string" || parsed.lastSelectedNodeId === null ? parsed.lastSelectedNodeId : null;
      metadata = {
        lastSelectedNodeId,
        outputScrollLeft: typeof parsed.outputScrollLeft === "number" ? parsed.outputScrollLeft : undefined,
        outputScrollTop: typeof parsed.outputScrollTop === "number" ? parsed.outputScrollTop : undefined,
        mainZoomPercent: typeof parsed.mainZoomPercent === "number" ? parsed.mainZoomPercent : undefined,
        typeColors: stringRecord(parsed.typeColors),
        nodeTypes: stringRecord(parsed.nodeTypes),
        revision: typeof parsed.revision === "number" ? parsed.revision : undefined
      };
    }
  } catch {}
  return { source: source.replace(headerPattern, "").replace(/\s+$/, ""), metadata };
}
function sourceWithEditorMetadata(source) {
  const body = splitEditorMetadata(source).source;
  const metadata = {
    lastSelectedNodeId: state.selectedEditorNodeId,
    outputScrollLeft: outputBox.scrollLeft,
    outputScrollTop: outputBox.scrollTop,
    mainZoomPercent: state.mainZoomPercent,
    typeColors: state.typeColors,
    nodeTypes: state.nodeTypes,
    revision: state.editSeq
  };
  return `${body}
${EDITOR_METADATA_FENCE}
%% ${EDITOR_METADATA_WARNING}
%% ${JSON.stringify(metadata)}
${EDITOR_METADATA_FENCE}`;
}
function stringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string")
      result[key] = entry;
  }
  return result;
}
function restoreTypeMetadata(metadata) {
  state.typeColors = { ...DEFAULT_TYPE_COLORS, ...metadata?.typeColors ?? {} };
  state.nodeTypes = { ...metadata?.nodeTypes ?? {} };
}
function setEditorActionPromise(promise) {
  state.editorActionPromise = promise;
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
function declarationRequirement(id) {
  if (id.startsWith("Q_CHOICE"))
    return 'start with "Q_CHOICE" and use bracket shape []';
  if (id.startsWith("Q_"))
    return 'start with "Q_" and use brace shape {}';
  if (id.startsWith("B_"))
    return 'start with "B_" and use bracket shape []';
  return 'use "Q_" with brace shape {} for a decision, "Q_CHOICE" with bracket shape [] for a choice, or "B_" with bracket shape [] for a static block';
}
function validateDeclaration(id, shape, lineNumber, problems) {
  const subject = `Line ${lineNumber}: id "${id}"`;
  if (shape === "other") {
    problems.push(`${subject} uses unsupported rounded/stadium shape; it must ${declarationRequirement(id)}.`);
    return;
  }
  if (id.startsWith("Q_CHOICE")) {
    if (shape !== "rect")
      problems.push(`${subject} is a choice and must use bracket shape [] (for example, ${id}["Choice"]).`);
    return;
  }
  if (id.startsWith("Q_")) {
    if (shape !== "brace")
      problems.push(`${subject} is a decision and must use brace shape {} (for example, ${id}{"Decision"}).`);
    return;
  }
  if (id.startsWith("B_")) {
    if (shape !== "rect")
      problems.push(`${subject} is a static block and must use bracket shape [] (for example, ${id}["Block"]).`);
    return;
  }
  problems.push(`${subject} has a non-compliant prefix; it must ${declarationRequirement(id)}.`);
}
function parseEditorEdgeLine(line) {
  const separator = /\s--\s(?:"([^"]*)"|(.+?))\s-->\s|\s-->/g;
  const tokens = [];
  const labels = [];
  let tokenStart = 0;
  for (let match;match = separator.exec(line); ) {
    tokens.push(line.slice(tokenStart, match.index).trim());
    labels.push(match[1] ?? match[2]?.trim());
    tokenStart = match.index + match[0].length;
  }
  if (tokens.length === 0)
    return null;
  tokens.push(line.slice(tokenStart).trim());
  if (tokens.some((token) => !token))
    return null;
  return tokens.slice(0, -1).map((fromToken, index) => ({ fromToken, label: labels[index], toToken: tokens[index + 1] }));
}
function declarationSuffixOf(node) {
  if (node.kind === "question")
    return `{"${node.label}"}`;
  if (node.kind === "choice")
    return `["${node.label}"]`;
  return `["${node.label}"]`;
}
function editorGraph() {
  const lines = codeBox.value.split(`
`);
  const declLines = new Map;
  const edges = [];
  const references = new Map;
  const problems = [];
  const recordDecl = (token, lineIndex) => {
    if (token.shape && !declLines.has(token.id))
      declLines.set(token.id, { shape: token.shape, label: token.label, lineIndex });
  };
  for (let lineIndex = 0;lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    const isSkippable = !line || line.startsWith("flowchart") || line.startsWith("classDef") || line.startsWith("class ") || line.startsWith("%%");
    if (isSkippable)
      continue;
    const parsedEdges = parseEditorEdgeLine(line);
    if (parsedEdges) {
      for (const edge of parsedEdges) {
        const from = parseEditorToken(edge.fromToken);
        const to = parseEditorToken(edge.toToken);
        for (const token of [from, to]) {
          references.set(token.id, lineIndex);
          if (token.shape) {
            problems.push(`Line ${lineIndex + 1}: id "${token.id}" is declared inline on an edge; node declarations must be on their own standalone lines.`);
            validateDeclaration(token.id, token.shape, lineIndex + 1, problems);
          }
        }
        edges.push({ from: from.id, to: to.id, label: edge.label, lineIndex });
      }
    } else {
      const decl = parseEditorToken(line);
      if (decl.shape) {
        recordDecl(decl, lineIndex);
        validateDeclaration(decl.id, decl.shape, lineIndex + 1, problems);
      }
    }
  }
  for (const [id, lineIndex] of references) {
    if (!declLines.has(id))
      problems.push(`Line ${lineIndex + 1}: id "${id}" must be declared on its own standalone line and ${declarationRequirement(id)}.`);
  }
  const uniqueProblems = [...new Set(problems)];
  if (uniqueProblems.length) {
    const error = new EditorValidationError(uniqueProblems);
    showEditorValidationError(error);
    throw error;
  }
  const nodes = new Map;
  for (const [id, decl] of declLines) {
    const kind = id.startsWith("Q_CHOICE") ? "choice" : id.startsWith("Q_") ? "question" : "block";
    nodes.set(id, { id, kind, label: decl.label, lineIndex: decl.lineIndex });
  }
  return { lines, nodes, edges };
}

// node-type-colors.ts
function effectiveNodeType(node) {
  if (node.kind === "question")
    return "decision";
  if (node.kind === "choice")
    return "choice";
  return state.nodeTypes[node.id]?.trim() || "static";
}
function colorForNode(node) {
  return state.typeColors[effectiveNodeType(node)] ?? state.typeColors.static;
}
function applyNodeTypeColors(graph) {
  for (const box of [diagramBox, phoneDiagramBox]) {
    for (const nodeEl of box.querySelectorAll("g.node")) {
      const node = graph.nodes.get(nodeIdOf(nodeEl));
      if (!node)
        continue;
      const color = colorForNode(node);
      for (const shape of nodeEl.querySelectorAll("rect, path, polygon"))
        shape.style.fill = color;
    }
  }
}
async function saveTypeMetadata() {
  codeBox.value = sourceWithEditorMetadata(codeBox.value);
  await saveDiagram();
}
function commitNodeType() {
  const id = state.selectedEditorNodeId;
  if (!id)
    return;
  let graph;
  try {
    graph = editorGraph();
  } catch {
    return;
  }
  const node = graph.nodes.get(id);
  if (!node || node.kind !== "block")
    return;
  const type = nodeTypeInput.value.trim() || "static";
  if (type === "static")
    delete state.nodeTypes[id];
  else
    state.nodeTypes[id] = type;
  nodeTypeInput.value = type;
  applyNodeTypeColors(graph);
  setEditorActionPromise(saveTypeMetadata());
}
function commitTypeColor() {
  const id = state.selectedEditorNodeId;
  if (!id)
    return;
  let graph;
  try {
    graph = editorGraph();
  } catch {
    return;
  }
  const node = graph.nodes.get(id);
  if (!node)
    return;
  state.typeColors[effectiveNodeType(node)] = nodeTypeColorInput.value;
  applyNodeTypeColors(graph);
  setEditorActionPromise(saveTypeMetadata());
}

// source-edit.ts
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
  return `Q_CHOICE_${questionId.replace(/^Q_/, "")}_${suffix}`;
}
function outgoingDestination(id, graph) {
  return graph.edges.find((edge) => edge.from === id)?.to;
}
function sourceWithOutgoingChanged(id, destination, graph) {
  const removedLineIndexes = new Set;
  const restoredIds = new Set;
  const newLines = [];
  for (const edge of graph.edges) {
    if (edge.from !== id)
      continue;
    removedLineIndexes.add(edge.lineIndex);
    for (const endpointId of [edge.from, edge.to]) {
      const endpoint = graph.nodes.get(endpointId);
      if (endpoint && endpoint.lineIndex === edge.lineIndex && !restoredIds.has(endpointId)) {
        restoredIds.add(endpointId);
        newLines.push(`  ${endpointId}${declarationSuffixOf(endpoint)}`);
      }
    }
  }
  if (destination)
    newLines.push(`  ${id} --> ${destination}`);
  return sourceWithLinesReplaced(graph, removedLineIndexes, newLines);
}
function replaceOutgoing(id, destination, graph) {
  return sourceWithOutgoingChanged(id, destination, graph);
}
function removeOutgoing(id, graph) {
  return sourceWithOutgoingChanged(id, undefined, graph);
}
function preserveInlineDecl(edge, keepEndpointId, graph, newLines) {
  const node = graph.nodes.get(keepEndpointId);
  if (node && node.lineIndex === edge.lineIndex)
    newLines.push(`  ${keepEndpointId}${declarationSuffixOf(node)}`);
}

// node-inspector.ts
function replaceDeclarationInLine(line, id, newToken) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedId}(\\{[^}]*\\}|\\[[^\\]]*\\]|\\(\\[[^\\]]*\\]\\))`);
  return line.replace(re, newToken);
}
function inspectorActionButton(action, label, spanTwoColumns = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  button.textContent = label;
  button.classList.toggle("span-2", spanTwoColumns);
  return button;
}
function renderNodeInspector() {
  let graph;
  try {
    graph = editorGraph();
  } catch {
    nodeInspector.hidden = true;
    return;
  }
  const node = graph.nodes.get(state.selectedEditorNodeId ?? "");
  nodeInspector.hidden = !node;
  if (!node)
    return;
  const previewing = !!state.pendingRemoval;
  nodeInspectorTitle.textContent = INSPECTOR_TITLES[node.kind];
  nodeTextInput.value = node.label;
  const nodeType = effectiveNodeType(node);
  nodeTypeRow.hidden = previewing || node.kind !== "block";
  nodeTypeColorRow.hidden = previewing;
  nodeTypeInput.value = node.kind === "block" ? nodeType : "";
  nodeTypeColorInput.value = colorForNode(node);
  nodeInspectorRemovalPreview.hidden = !previewing;
  nodeInspectorActions.hidden = previewing;
  nodeInspectorControls.hidden = previewing;
  if (previewing) {
    positionNodeInspector();
    return;
  }
  const actions = [inspectorActionButton("remove", "Remove")];
  if (node.kind === "question")
    actions.push(inspectorActionButton("add-choice", "Add choice"), inspectorActionButton("remove-choices", "Remove choices"), inspectorActionButton("insert-static-before", "insert static block before"), inspectorActionButton("insert-decision-before", "insert Decision & leading choice before"));
  else if (node.kind === "block")
    actions.push(inspectorActionButton("add-decision-after", "add Decision block after"), inspectorActionButton("insert-decision-after", "Insert decision block after"), inspectorActionButton("insert-static-after", "Insert static block after"), inspectorActionButton("insert-static-before", "insert static block before"), inspectorActionButton("insert-decision-before", "insert Decision & leading choice before"));
  else if (node.kind === "choice")
    actions.push(inspectorActionButton("add-decision-after", "add Decision block after"), inspectorActionButton("add-static-after", "add static block after"), inspectorActionButton("insert-decision-after", "Insert decision block after"), inspectorActionButton("insert-static-after", "Insert static block after"));
  nodeInspectorActions.replaceChildren(...actions);
  const hasDestination = node.kind !== "question";
  destinationRow.hidden = !hasDestination;
  destinationSelect.replaceChildren();
  if (hasDestination) {
    destinationSelect.add(new Option("Terminal", ""));
    destinationSelect.add(new Option("New static block", NEW_STATIC_DESTINATION));
    destinationSelect.add(new Option("New Decision block", NEW_DECISION_DESTINATION));
    const destination = outgoingDestination(node.id, graph);
    for (const candidate of graph.nodes.values()) {
      const isSelf = candidate.id === node.id;
      const isHiddenChoice = candidate.kind === "choice" && candidate.id !== destination;
      if (isSelf || isHiddenChoice)
        continue;
      destinationSelect.add(new Option(`${candidate.label} (${candidate.id})`, candidate.id));
    }
    destinationSelect.value = destination ?? "";
    nodeInspectorDismissBtn.textContent = destination ? "Cancel" : "Close";
  } else {
    nodeInspectorDismissBtn.textContent = "Cancel";
  }
  positionNodeInspector();
}
function positionNodeInspector() {
  if (nodeInspector.hidden)
    return;
  const drawerRect = drawer.getBoundingClientRect();
  const mainRect = mainBox.getBoundingClientRect();
  nodeInspector.style.width = "";
  nodeInspector.style.left = drawerRect.right + "px";
  nodeInspector.style.top = mainRect.top + "px";
}
function focusInspectorText() {
  nodeTextInput.focus();
  nodeTextInput.select();
}
function focusInspectorDestination() {
  destinationSelect.focus();
}

// graph-slice.ts
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
function contextualDecisionSliceIds(decisionId, edges) {
  const reversed = [decisionId];
  const visited = new Set(reversed);
  let node = decisionId;
  for (;; ) {
    const incoming = edges.find(([, to]) => to === node);
    if (!incoming)
      break;
    const predecessor = incoming[0];
    if (visited.has(predecessor))
      break;
    reversed.push(predecessor);
    visited.add(predecessor);
    const isPreviousDecision = predecessor.startsWith("Q_") && !predecessor.startsWith("Q_CHOICE");
    if (isPreviousDecision)
      break;
    node = predecessor;
  }
  const ids = reversed.reverse();
  for (const choice of choicesOf(decisionId, edges)) {
    if (!visited.has(choice))
      ids.push(choice);
  }
  return ids;
}
function sliceIds(edges) {
  if (state.phoneFocusNodeId && state.phoneFocusUsesDecisionContext)
    return contextualDecisionSliceIds(state.phoneFocusNodeId, edges);
  const last = state.phonePreviewChoiceId ?? phonePath[phonePath.length - 1];
  const ids = state.phoneFocusNodeId ? [state.phoneFocusNodeId] : last ? [parentOf(last, edges), last] : [edges[0][0]];
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
  const hasDecisionContext = state.phoneFocusUsesDecisionContext || state.phonePreviewChoiceId || phonePath.length;
  if (!hasDecisionContext)
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
  const hasDecisionContext = state.phoneFocusUsesDecisionContext || state.phonePreviewChoiceId || phonePath.length;
  if (!hasDecisionContext)
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

// zoom.ts
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
  const { svg } = await mermaid.render("diagram-scale-" + state.renderId++, source);
  const box = viewBoxOf(svg);
  const screenWidth = phoneDiagramBox.clientWidth;
  const screenHeight = phoneDiagramBox.clientHeight;
  return Math.min(screenWidth / box.width, screenHeight / box.height);
}
function applyMainZoom(preserveViewportCenter = true) {
  zoomLevel.textContent = `${state.mainZoomPercent}%`;
  zoomInBtn.disabled = state.mainZoomPercent >= MAX_MAIN_ZOOM;
  zoomOutBtn.disabled = state.mainZoomPercent <= MIN_MAIN_ZOOM;
  zoomResetBtn.disabled = state.mainZoomPercent === 100;
  const svg = diagramBox.querySelector("svg");
  if (!svg || state.diagramScale === null)
    return;
  const oldWidth = Number.parseFloat(svg.style.width);
  const oldHeight = Number.parseFloat(svg.style.height);
  const centerX = outputBox.scrollLeft + outputBox.clientWidth / 2;
  const centerY = outputBox.scrollTop + outputBox.clientHeight / 2;
  const zoom = state.mainZoomPercent / 100;
  const newWidth = svg.viewBox.baseVal.width * state.diagramScale * zoom;
  const newHeight = svg.viewBox.baseVal.height * state.diagramScale * zoom;
  svg.style.width = newWidth + "px";
  svg.style.height = newHeight + "px";
  if (preserveViewportCenter && oldWidth > 0 && oldHeight > 0) {
    outputBox.scrollLeft = centerX * newWidth / oldWidth - outputBox.clientWidth / 2;
    outputBox.scrollTop = centerY * newHeight / oldHeight - outputBox.clientHeight / 2;
  }
}
function setMainZoomPercent(percent) {
  state.mainZoomPercent = Math.max(MIN_MAIN_ZOOM, Math.min(MAX_MAIN_ZOOM, Math.round(percent)));
  applyMainZoom();
}

// diagram-io.ts
function setStatus(text) {
  statusBox.textContent = text;
  setTimeout(() => {
    if (statusBox.textContent === text)
      statusBox.textContent = "";
  }, 2000);
}
function setDrawerOpen(open) {
  drawer.classList.toggle("closed", !open);
  positionNodeInspector();
}
async function loadList() {
  const names = await fetch("/api/diagrams").then((r) => r.json());
  selectBox.innerHTML = '<option value="" disabled ' + (state.currentName ? "" : "selected") + ">Diagrams</option>";
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === state.currentName)
      option.selected = true;
    selectBox.appendChild(option);
  }
}
function resetEditorHistory(text) {
  state.editorHistory = [text];
  state.editorHistoryIndex = 0;
  selectEditorNode(null);
}
function restoreMainViewport(metadata, graph) {
  const hasSavedLeft = typeof metadata?.outputScrollLeft === "number";
  const hasSavedTop = typeof metadata?.outputScrollTop === "number";
  if (hasSavedLeft)
    outputBox.scrollLeft = metadata.outputScrollLeft;
  if (hasSavedTop)
    outputBox.scrollTop = metadata.outputScrollTop;
  if (hasSavedLeft && hasSavedTop)
    return;
  const firstNode = graph.nodes.values().next().value;
  if (!firstNode)
    return;
  const node = diagramBox.querySelector('[id*="flowchart-' + firstNode.id + '-"]');
  if (!node)
    return;
  const outputRect = outputBox.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const nodeLeft = outputBox.scrollLeft + nodeRect.left - outputRect.left;
  const nodeTop = outputBox.scrollTop + nodeRect.top - outputRect.top;
  if (!hasSavedLeft)
    outputBox.scrollLeft = Math.max(0, nodeLeft - 12);
  if (!hasSavedTop)
    outputBox.scrollTop = Math.max(0, nodeTop - 12);
}
async function loadDiagram(name) {
  const text = await fetch("/api/diagrams/" + encodeURIComponent(name)).then((r) => r.text());
  const { metadata } = splitEditorMetadata(text);
  restoreTypeMetadata(metadata);
  state.currentName = name;
  phonePath.length = 0;
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  state.diagramScale = null;
  state.currentDecisionId = metadata?.lastSelectedNodeId ?? null;
  state.mainZoomPercent = metadata?.mainZoomPercent ?? 100;
  codeBox.value = text;
  resetEditorHistory(text);
  await render();
  applyMainZoom(false);
  let graph = null;
  try {
    graph = editorGraph();
  } catch {}
  if (metadata) {
    if (graph?.nodes.has(metadata.lastSelectedNodeId ?? ""))
      selectEditorNode(metadata.lastSelectedNodeId);
  }
  if (graph)
    restoreMainViewport(metadata, graph);
  loadList();
  watchDiagram(name);
}
function watchDiagram(name) {
  if (state.watcher)
    state.watcher.close();
  const source = new EventSource("/api/watch/" + encodeURIComponent(name));
  state.watcher = source;
  source.onmessage = async () => {
    const editSeqAtFetchStart = state.editSeq;
    const text = await fetch("/api/diagrams/" + encodeURIComponent(name)).then((r) => r.text());
    const isStaleWatcher = state.watcher !== source;
    const isStaleFetch = state.editSeq !== editSeqAtFetchStart;
    if (isStaleWatcher || isStaleFetch)
      return;
    const fetchedMetadata = splitEditorMetadata(text).metadata;
    if (typeof fetchedMetadata?.revision === "number" && fetchedMetadata.revision < state.editSeq)
      return;
    if (text !== codeBox.value) {
      restoreTypeMetadata(fetchedMetadata);
      codeBox.value = text;
      resetEditorHistory(text);
    }
    render();
  };
}
async function saveDiagram() {
  let name = state.currentName;
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
  state.currentName = name;
  setStatus("Saved " + name);
  loadList();
  watchDiagram(name);
}

// decision-nav.ts
function decisionNodes(graph) {
  return [...graph.nodes.values()].filter((node) => node.kind === "question").sort((a, b) => a.lineIndex - b.lineIndex);
}
function nearestDecisionFrom(id, step, graph) {
  const visited = new Set([id]);
  let frontier = [id];
  while (frontier.length) {
    const nextFrontier = [];
    for (const nodeId of frontier) {
      for (const edge of graph.edges) {
        const neighbor = step === 1 ? edge.from === nodeId ? edge.to : null : edge.to === nodeId ? edge.from : null;
        if (!neighbor || visited.has(neighbor))
          continue;
        visited.add(neighbor);
        if (graph.nodes.get(neighbor)?.kind === "question")
          return graph.nodes.get(neighbor);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }
}
function nearestFeedingChoice(id, graph) {
  const visited = new Set([id]);
  let frontier = [id];
  while (frontier.length) {
    const nextFrontier = [];
    for (const nodeId of frontier) {
      const node = graph.nodes.get(nodeId);
      const isChoiceFedByDecision = node?.kind === "choice" && graph.edges.some((edge) => edge.to === nodeId && graph.nodes.get(edge.from)?.kind === "question");
      if (isChoiceFedByDecision)
        return nodeId;
      for (const edge of graph.edges) {
        if (edge.to !== nodeId || visited.has(edge.from))
          continue;
        visited.add(edge.from);
        nextFrontier.push(edge.from);
      }
    }
    frontier = nextFrontier;
  }
  return null;
}
function discardInvalidPhonePreview(graph) {
  if (state.phoneFocusNodeId && graph.nodes.get(state.phoneFocusNodeId)?.kind !== "question") {
    state.phoneFocusNodeId = null;
    state.phoneFocusUsesDecisionContext = false;
  }
  if (state.phonePreviewChoiceId && nearestFeedingChoice(state.phonePreviewChoiceId, graph) !== state.phonePreviewChoiceId)
    state.phonePreviewChoiceId = null;
}
function updateDecisionCounter(graph) {
  const decisions = decisionNodes(graph);
  if (decisions.length === 0) {
    state.currentDecisionId = null;
    decisionCounter.textContent = "0 / 0";
    return decisions;
  }
  if (!decisions.some((node) => node.id === state.currentDecisionId)) {
    const selectedDecision = decisions.find((node) => node.id === state.selectedEditorNodeId);
    state.currentDecisionId = selectedDecision?.id ?? decisions[0].id;
  }
  const current = decisions.findIndex((node) => node.id === state.currentDecisionId) + 1;
  decisionCounter.textContent = `${current} / ${decisions.length}`;
  return decisions;
}
function centerNodeInViewport(container, diagram, id) {
  const node = diagram.querySelector('[id*="flowchart-' + id + '-"]');
  if (!node)
    return;
  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  container.scrollLeft += nodeRect.left + nodeRect.width / 2 - containerRect.left - container.clientWidth / 2;
  container.scrollTop += nodeRect.top + nodeRect.height / 2 - containerRect.top - container.clientHeight / 2;
}
async function navigateDecision(step) {
  let graph;
  try {
    graph = editorGraph();
  } catch (error) {
    showEditorValidationError(error);
    return;
  }
  const decisions = updateDecisionCounter(graph);
  if (decisions.length === 0) {
    setStatus("No decisions in this diagram");
    return;
  }
  const selected = graph.nodes.get(state.selectedEditorNodeId ?? "");
  const nearest = selected ? nearestDecisionFrom(selected.id, step, graph) : undefined;
  const anchorId = selected?.kind === "question" ? selected.id : state.currentDecisionId;
  const currentIndex = decisions.findIndex((node) => node.id === anchorId);
  const nextIndex = (currentIndex + step + decisions.length) % decisions.length;
  const decision = nearest ?? decisions[nextIndex];
  state.currentDecisionId = decision.id;
  state.phoneFocusNodeId = decision.id;
  state.phoneFocusUsesDecisionContext = true;
  state.phonePreviewChoiceId = null;
  selectEditorNode(decision.id);
  updateDecisionCounter(graph);
  await render();
  centerNodeInViewport(outputBox, diagramBox, decision.id);
}

// phone-separators.ts
function drawSeparatorBetween(topId, belowIds, label) {
  const svg = phoneDiagramBox.querySelector("svg");
  const nodeEl = (id) => phoneDiagramBox.querySelector('[id*="flowchart-' + id + '-"]');
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
function drawLastDecisionMask(ids, edges, openDecisionId) {
  const svg = phoneDiagramBox.querySelector("svg");
  const nodeEl = (id) => phoneDiagramBox.querySelector('[id*="flowchart-' + id + '-"]');
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
  let maskBottom = Math.max(...bottoms) + 12;
  if (openDecisionId && openDecisionId !== ids[0]) {
    const protectedEls = [];
    for (const id of [openDecisionId, ...choicesOf(openDecisionId, edges)]) {
      const el = nodeEl(id);
      if (el)
        protectedEls.push(el);
    }
    if (protectedEls.length) {
      const protectedTop = Math.min(...protectedEls.map((el) => yOf(el) - el.getBBox().height / 2));
      maskBottom = Math.min(maskBottom, protectedTop - 4);
    }
  }
  const viewBoxParts = svg.getAttribute("viewBox").split(" ");
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, y, width] = viewBoxNumbers;
  const maskHeight = Math.max(0, maskBottom - y);
  if (maskHeight === 0)
    return;
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x - 1e4));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(width + 20000));
  rect.setAttribute("height", String(maskHeight));
  rect.setAttribute("fill", "rgba(0,0,0,0.25)");
  rect.setAttribute("class", "last-decision-mask");
  rect.setAttribute("pointer-events", "none");
  svg.appendChild(rect);
}
function scrollChoicesIntoView(bottomQ, edges) {
  if (state.phoneFocusNodeId) {
    centerNodeInViewport(phoneDiagramBox, phoneDiagramBox, state.phoneFocusNodeId);
    return;
  }
  const atStart = phonePath.length === 0;
  if (atStart) {
    phoneDiagramBox.scrollTop = 0;
    return;
  }
  if (!bottomQ)
    return;
  let lastChoice = null;
  for (const [from, to] of edges) {
    const isChoice = from === bottomQ;
    if (isChoice)
      lastChoice = phoneDiagramBox.querySelector('[id*="flowchart-' + to + '-"]');
  }
  if (!lastChoice)
    return;
  lastChoice.scrollIntoView({ block: "end" });
}

// render.ts
async function render() {
  errorBox.textContent = "";
  try {
    const graph = editorGraph();
    discardInvalidPhonePreview(graph);
    updateDecisionCounter(graph);
    const edges = parseEdges(codeBox.value);
    const ids = edges.length > 0 ? sliceIds(edges) : [];
    const siblings = siblingIds(ids, edges);
    const leadIns = leadInIds(ids, siblings, edges);
    const shown = new Set([...ids, ...siblings, ...leadIns]);
    const reversedIds = [...ids].reverse();
    let bottomQ = state.phoneFocusNodeId && graph.nodes.get(state.phoneFocusNodeId)?.kind === "question" ? state.phoneFocusNodeId : undefined;
    if (!bottomQ) {
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
    }
    state.currentBottomQ = bottomQ;
    const phoneSource = edges.length > 0 ? chunkSource(shown, siblings, edges) : codeBox.value;
    const regularViewport = { left: outputBox.scrollLeft, top: outputBox.scrollTop };
    const phoneViewport = { left: phoneDiagramBox.scrollLeft, top: phoneDiagramBox.scrollTop };
    const myRenderId = state.renderId;
    const [{ svg: regularSvg }, { svg: phoneSvg }] = await Promise.all([
      mermaid.render("diagram-" + state.renderId++, codeBox.value),
      mermaid.render("phone-diagram-" + state.renderId++, phoneSource)
    ]);
    if (state.renderId !== myRenderId + 2)
      return;
    diagramBox.innerHTML = regularSvg;
    phoneDiagramBox.innerHTML = phoneSvg;
    applyNodeTypeColors(graph);
    renderEditorSelection();
    highlightPath();
    if (edges.length > 0) {
      if (state.diagramScale === null)
        state.diagramScale = await baseScale(edges);
      const scale = state.diagramScale;
      const mainZoom = state.mainZoomPercent / 100;
      const regularSvgEl = diagramBox.querySelector("svg");
      const regularBox = viewBoxOf(regularSvg);
      regularSvgEl.style.width = regularBox.width * scale * mainZoom + "px";
      regularSvgEl.style.height = regularBox.height * scale * mainZoom + "px";
      const phoneSvgEl = phoneDiagramBox.querySelector("svg");
      const phoneBox = viewBoxOf(phoneSvg);
      const phoneWidth = Math.max(phoneBox.width * scale, phoneDiagramBox.clientWidth);
      phoneSvgEl.style.width = phoneWidth + "px";
      phoneSvgEl.style.height = phoneBox.height * scale + "px";
    }
    outputBox.scrollLeft = regularViewport.left;
    outputBox.scrollTop = regularViewport.top;
    phoneDiagramBox.scrollLeft = phoneViewport.left;
    phoneDiagramBox.scrollTop = phoneViewport.top;
    renderLog(edges);
    const hasContextualPreviousDecision = state.phoneFocusUsesDecisionContext && ids[0] !== state.phoneFocusNodeId && graph.nodes.get(ids[0])?.kind === "question";
    const shouldDrawLastDecision = edges.length > 0 && (phonePath.length > 0 || state.phonePreviewChoiceId || hasContextualPreviousDecision);
    if (shouldDrawLastDecision)
      drawLastDecisionMask(ids, edges, bottomQ);
    if (shouldDrawLastDecision)
      drawSeparatorBetween(ids[0], choicesOf(ids[0], edges), "last decision");
    const shouldDrawBottomSeparator = edges.length > 0 && bottomQ;
    if (shouldDrawBottomSeparator)
      drawSeparatorBetween(bottomQ, choicesOf(bottomQ, edges), "open decision");
    if (edges.length > 0)
      scrollChoicesIntoView(bottomQ, edges);
    positionNodeInspector();
    errorLog.textContent = "";
    errorLog.classList.remove("open");
  } catch (err) {
    state.currentDecisionId = null;
    decisionCounter.textContent = "0 / 0";
    showEditorValidationError(err);
  }
}

// editor-actions.ts
async function commitEditorSource(source, options) {
  state.editSeq++;
  source = sourceWithEditorMetadata(source);
  await mermaid.parse(source);
  codeBox.value = source;
  const recordHistory = options?.recordHistory !== false;
  if (recordHistory) {
    state.editorHistory = state.editorHistory.slice(0, state.editorHistoryIndex + 1);
    state.editorHistory.push(source);
    state.editorHistoryIndex = state.editorHistory.length - 1;
  }
  await render();
  await saveDiagram();
  selectEditorNode(null);
}
function enqueueEditorAction(action) {
  setEditorActionPromise(state.editorActionPromise.catch(() => {}).then(action));
}
function runEditorAction(action) {
  enqueueEditorAction(action);
}
function selectEditorNode(id) {
  state.selectedEditorNodeId = id;
  if (state.advanceAfterDecisionText?.decisionId !== id)
    state.advanceAfterDecisionText = null;
  if (state.focusDestinationAfterTextId !== id)
    state.focusDestinationAfterTextId = null;
  state.pendingRemoval = null;
  nodeActions.classList.remove("removing");
  nodeActions.classList.toggle("open", !!id);
  selectedNodeBox.textContent = id ?? "";
  renderEditorSelection();
  renderNodeInspector();
}
function renderEditorSelection() {
  for (const el of diagramBox.querySelectorAll(".editor-selected"))
    el.classList.remove("editor-selected");
  for (const el of diagramBox.querySelectorAll(".editor-preview"))
    el.classList.remove("editor-preview");
  if (state.selectedEditorNodeId) {
    const el = diagramBox.querySelector('[id*="flowchart-' + state.selectedEditorNodeId + '-"]');
    if (el)
      el.classList.add("editor-selected");
  }
  if (state.pendingRemoval) {
    const target = state.pendingRemoval.choices[state.pendingRemoval.index];
    const el = diagramBox.querySelector('[id*="flowchart-' + target + '-"]');
    if (el)
      el.classList.add("editor-preview");
  }
}
function showRemovalPreview() {
  renderEditorSelection();
  renderNodeInspector();
}

// editor-add.ts
function addQuestionAfter() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = state.selectedEditorNodeId;
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
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = state.selectedEditorNodeId;
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
function insertStaticBefore() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = state.selectedEditorNodeId;
  const selectedNode = graph.nodes.get(selected);
  const removedLineIndexes = new Set;
  const predecessors = [];
  for (const edge of graph.edges) {
    if (edge.to !== selected)
      continue;
    predecessors.push(edge);
    removedLineIndexes.add(edge.lineIndex);
  }
  const staticId = nextEditorId("B_NEW", graph);
  const newLines = [`  ${staticId}["New static block"]`];
  const restoredInlineDecls = new Set;
  const restoreInlineDecl = (edge, endpointId) => {
    const node = graph.nodes.get(endpointId);
    if (node && node.lineIndex === edge.lineIndex && !restoredInlineDecls.has(endpointId)) {
      restoredInlineDecls.add(endpointId);
      newLines.push(`  ${endpointId}${declarationSuffixOf(node)}`);
    }
  };
  if (removedLineIndexes.has(selectedNode.lineIndex))
    newLines.push(`  ${selected}${declarationSuffixOf(selectedNode)}`);
  restoredInlineDecls.add(selected);
  for (const edge of predecessors)
    restoreInlineDecl(edge, edge.from);
  for (const edge of predecessors)
    newLines.push(edge.label ? `  ${edge.from} -- "${edge.label}" --> ${staticId}` : `  ${edge.from} --> ${staticId}`);
  newLines.push(`  ${staticId} --> ${selected}`);
  for (const edge of graph.edges) {
    if (!removedLineIndexes.has(edge.lineIndex) || edge.to === selected)
      continue;
    restoreInlineDecl(edge, edge.from);
    restoreInlineDecl(edge, edge.to);
    newLines.push(edge.label ? `  ${edge.from} -- "${edge.label}" --> ${edge.to}` : `  ${edge.from} --> ${edge.to}`);
  }
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}
function insertDecisionBefore() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = state.selectedEditorNodeId;
  const selectedNode = graph.nodes.get(selected);
  const removedLineIndexes = new Set;
  const predecessors = [];
  for (const edge of graph.edges) {
    if (edge.to !== selected)
      continue;
    predecessors.push(edge);
    removedLineIndexes.add(edge.lineIndex);
  }
  const decisionId = nextEditorId("Q_NEW", graph);
  const newChoiceId = choiceId(decisionId, "NEW");
  const newLines = [
    `  ${decisionId}{"New Decision"}`,
    `  ${newChoiceId}["New choice"]`,
    `  ${decisionId} --> ${newChoiceId}`
  ];
  if (removedLineIndexes.has(selectedNode.lineIndex))
    newLines.push(`  ${selected}${declarationSuffixOf(selectedNode)}`);
  for (const edge of predecessors)
    preserveInlineDecl(edge, edge.from, graph, newLines);
  for (const edge of predecessors)
    newLines.push(edge.label ? `  ${edge.from} -- "${edge.label}" --> ${decisionId}` : `  ${edge.from} --> ${decisionId}`);
  newLines.push(`  ${newChoiceId} --> ${selected}`);
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}
function choiceSuffixFromLabel(label) {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "CHOICE";
}
function addChoice() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = state.selectedEditorNodeId;
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

// editor-remove.ts
function removeChoice() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const id = state.selectedEditorNodeId;
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
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const id = state.selectedEditorNodeId;
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
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = state.selectedEditorNodeId;
  const choices = [];
  for (const edge of graph.edges) {
    if (edge.from === questionId)
      choices.push(edge.to);
  }
  if (!choices.length)
    return;
  state.pendingRemoval = { questionId, choices, index: 0 };
  nodeActions.classList.add("removing");
  showRemovalPreview();
}
function removeChoices() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = state.selectedEditorNodeId;
  const removedLineIndexes = new Set;
  const newLines = [];
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
    const choiceNodeId = edge.to;
    removedLineIndexes.add(targetNode.lineIndex);
    for (const inner of graph.edges) {
      if (inner === edge)
        continue;
      const touchesChoice = inner.from === choiceNodeId || inner.to === choiceNodeId;
      if (!touchesChoice)
        continue;
      removedLineIndexes.add(inner.lineIndex);
      const otherEndpoint = inner.from === choiceNodeId ? inner.to : inner.from;
      if (otherEndpoint !== choiceNodeId)
        preserveInlineDecl(inner, otherEndpoint, graph, newLines);
    }
  }
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}
function advanceRemovalPreview() {
  if (!state.pendingRemoval)
    return;
  state.pendingRemoval.index = (state.pendingRemoval.index + 1) % state.pendingRemoval.choices.length;
  showRemovalPreview();
}
function cancelQuestionRemoval() {
  selectEditorNode(null);
}
function confirmQuestionRemoval() {
  if (!state.pendingRemoval)
    return;
  const { questionId, choices, index } = state.pendingRemoval;
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
  if (state.editorHistoryIndex <= 0)
    return;
  state.editorHistoryIndex--;
  runEditorAction(() => commitEditorSource(state.editorHistory[state.editorHistoryIndex], { recordHistory: false }));
}
function redoEditorAction() {
  if (state.editorHistoryIndex >= state.editorHistory.length - 1)
    return;
  state.editorHistoryIndex++;
  runEditorAction(() => commitEditorSource(state.editorHistory[state.editorHistoryIndex], { recordHistory: false }));
}

// editor-commit.ts
async function commitNewStaticAfter(sourceId, graph) {
  const staticId = nextEditorId("B_NEW", graph);
  const source = `${replaceOutgoing(sourceId, staticId, graph)}
  ${staticId}["New static block"]`;
  await commitEditorSource(source);
  state.focusDestinationAfterTextId = staticId;
  selectEditorNode(staticId);
  focusInspectorText();
}
async function commitInsertStaticAfter(sourceId, graph) {
  const staticId = nextEditorId("B_NEW", graph);
  const oldDestination = outgoingDestination(sourceId, graph);
  const newLines = [`  ${staticId}["New static block"]`];
  if (oldDestination)
    newLines.push(`  ${staticId} --> ${oldDestination}`);
  const source = `${replaceOutgoing(sourceId, staticId, graph)}
${newLines.join(`
`)}`;
  await commitEditorSource(source);
  state.focusDestinationAfterTextId = staticId;
  selectEditorNode(staticId);
  focusInspectorText();
}
async function commitInsertDecisionAfter(sourceId, graph) {
  const removedLineIndexes = new Set;
  const successors = [];
  for (const edge of graph.edges) {
    if (edge.from !== sourceId)
      continue;
    successors.push(edge);
    removedLineIndexes.add(edge.lineIndex);
  }
  const decisionId = nextEditorId("Q_NEW", graph);
  const yesId = choiceId(decisionId, "Y");
  const noId = choiceId(decisionId, "N");
  const newLines = [
    `  ${decisionId}{"New Decision"}`,
    `  ${yesId}["Yes"]`,
    `  ${noId}["No"]`,
    `  ${sourceId} --> ${decisionId}`,
    `  ${decisionId} --> ${yesId}`,
    `  ${decisionId} --> ${noId}`
  ];
  const restoredInlineDecls = new Set;
  const restoreInlineDecl = (edge, endpointId) => {
    const node = graph.nodes.get(endpointId);
    if (node && node.lineIndex === edge.lineIndex && !restoredInlineDecls.has(endpointId)) {
      restoredInlineDecls.add(endpointId);
      newLines.push(`  ${endpointId}${declarationSuffixOf(node)}`);
    }
  };
  for (const edge of successors) {
    restoreInlineDecl(edge, edge.to);
    newLines.push(`  ${yesId} --> ${edge.to}`);
  }
  for (const edge of graph.edges) {
    if (!removedLineIndexes.has(edge.lineIndex) || edge.from === sourceId)
      continue;
    restoreInlineDecl(edge, edge.from);
    restoreInlineDecl(edge, edge.to);
    newLines.push(edge.label ? `  ${edge.from} -- "${edge.label}" --> ${edge.to}` : `  ${edge.from} --> ${edge.to}`);
  }
  await commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines));
  selectEditorNode(decisionId);
  focusInspectorText();
}
async function commitNewDecisionAfter(sourceId, graph) {
  await commitInsertDecisionAfter(sourceId, graph);
}
async function commitAddChoiceOnDecision(questionId, graph) {
  const removedLineIndexes = new Set;
  let suffix = "NEW";
  let n = 1;
  while (graph.nodes.has(choiceId(questionId, suffix)))
    suffix = "NEW" + ++n;
  const cid = choiceId(questionId, suffix);
  const newLines = [`  ${cid}["New choice"]`, `  ${questionId} --> ${cid}`];
  await commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines));
  selectEditorNode(questionId);
}
function addChoiceOnDecision() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = state.selectedEditorNodeId;
  setEditorActionPromise(commitAddChoiceOnDecision(questionId, graph));
}
function commitNodeText(id = state.selectedEditorNodeId, text = nodeTextInput.value.trim()) {
  if (!id)
    return;
  const advance = state.advanceAfterDecisionText?.decisionId === id ? state.advanceAfterDecisionText : null;
  const focusDestination = state.focusDestinationAfterTextId === id;
  if (advance)
    state.advanceAfterDecisionText = null;
  if (focusDestination)
    state.focusDestinationAfterTextId = null;
  enqueueEditorAction(async () => {
    const graph = editorGraph();
    const node = graph.nodes.get(id);
    if (!node)
      return;
    if (node.label !== text) {
      const newToken = node.kind === "question" ? `${id}{"${text}"}` : `${id}["${text}"]`;
      const lines = graph.lines.slice();
      lines[node.lineIndex] = replaceDeclarationInLine(lines[node.lineIndex], id, newToken);
      await commitEditorSource(lines.join(`
`));
    }
    if (advance) {
      selectEditorNode(advance.choiceId);
      focusInspectorDestination();
    } else if (focusDestination) {
      selectEditorNode(id);
      focusInspectorDestination();
    }
  });
}
function applyDestination(destination) {
  const id = state.selectedEditorNodeId;
  if (!id)
    return;
  const graph = editorGraph();
  const node = graph.nodes.get(id);
  if (!node || node.kind === "question")
    return;
  const createsStatic = destination === NEW_STATIC_DESTINATION;
  const createsDecision = destination === NEW_DECISION_DESTINATION;
  if (!createsStatic && !createsDecision && outgoingDestination(id, graph) === (destination || undefined))
    return;
  const text = nodeTextInput.value.trim();
  if (text !== node.label)
    commitNodeText(id, text);
  enqueueEditorAction(async () => {
    const currentGraph = editorGraph();
    if (createsStatic)
      await commitNewStaticAfter(id, currentGraph);
    else if (createsDecision)
      await commitNewDecisionAfter(id, currentGraph);
    else {
      const source = destination ? replaceOutgoing(id, destination, currentGraph) : removeOutgoing(id, currentGraph);
      await commitEditorSource(source);
    }
  });
}
function commitDestination() {
  applyDestination(destinationSelect.value);
}

// editor-events.ts
outputBox.addEventListener("click", (event) => {
  const nodeEl = event.target.closest("g.node");
  const id = nodeEl ? nodeIdOf(nodeEl) : null;
  selectEditorNode(id);
  if (id) {
    const graph = editorGraph();
    const node = graph.nodes.get(id);
    if (node?.kind === "question") {
      state.phoneFocusNodeId = id;
      state.phoneFocusUsesDecisionContext = true;
      state.phonePreviewChoiceId = null;
      render();
    } else {
      const feedingChoice = nearestFeedingChoice(id, graph);
      if (feedingChoice) {
        state.phoneFocusNodeId = null;
        state.phoneFocusUsesDecisionContext = false;
        state.phonePreviewChoiceId = feedingChoice;
        render();
      }
    }
  }
});
phoneDiagramBox.addEventListener("click", (event) => {
  const nodeEl = event.target.closest("g.node");
  if (!nodeEl)
    return;
  const clicked = nodeIdOf(nodeEl);
  const edges = parseEdges(codeBox.value);
  if (!isAnswerId(clicked, edges))
    return;
  const openChoices = state.currentBottomQ ? choicesOf(state.currentBottomQ, edges) : [];
  if (!openChoices.includes(clicked))
    return;
  phonePath.push(clicked);
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  render();
});
outputBox.addEventListener("dblclick", (event) => {
  const nodeEl = event.target.closest("g.node");
  if (!nodeEl)
    return;
  selectEditorNode(nodeIdOf(nodeEl));
  nodeTextInput.focus();
  nodeTextInput.select();
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
document.getElementById("nodeInspectorDismissBtn").addEventListener("click", () => selectEditorNode(null));
destinationSelect.addEventListener("change", commitDestination);
nodeInspectorActions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const action = button?.dataset.action;
  if (action === "add-static-after")
    applyDestination(NEW_STATIC_DESTINATION);
  else if (action === "insert-static-after") {
    if (!state.selectedEditorNodeId)
      return;
    setEditorActionPromise(commitInsertStaticAfter(state.selectedEditorNodeId, editorGraph()));
  } else if (action === "insert-decision-after") {
    if (!state.selectedEditorNodeId)
      return;
    setEditorActionPromise(commitInsertDecisionAfter(state.selectedEditorNodeId, editorGraph()));
  } else if (action === "add-decision-after")
    applyDestination(NEW_DECISION_DESTINATION);
  else if (action === "add-choice")
    addChoiceOnDecision();
  else if (action === "remove") {
    const kind = editorGraph().nodes.get(state.selectedEditorNodeId ?? "")?.kind;
    if (kind === "question")
      removeQuestion();
    else if (kind === "block")
      removeBlock();
    else if (kind === "choice")
      removeChoice();
  } else if (action === "remove-choices")
    removeChoices();
  else if (action === "insert-static-before")
    insertStaticBefore();
  else if (action === "insert-decision-before")
    insertDecisionBefore();
});
nodeTextInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter")
    return;
  event.preventDefault();
  commitNodeText();
});
nodeTypeInput.addEventListener("change", commitNodeType);
nodeTypeColorInput.addEventListener("change", commitTypeColor);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape")
    return;
  selectEditorNode(null);
});
outputBox.addEventListener("scroll", positionNodeInspector);
window.addEventListener("resize", positionNodeInspector);

// main-events.ts
document.getElementById("newBtn").addEventListener("click", () => {
  if (state.watcher)
    state.watcher.close();
  state.currentName = null;
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  state.diagramScale = null;
  state.currentDecisionId = null;
  restoreTypeMetadata(null);
  codeBox.value = `flowchart TD
  B_NEW[New idea]`;
  resetEditorHistory(codeBox.value);
  render();
  loadList();
  setDrawerOpen(true);
});
document.getElementById("saveBtn").addEventListener("click", saveDiagram);
previousDecisionBtn.addEventListener("click", () => navigateDecision(-1));
nextDecisionBtn.addEventListener("click", () => navigateDecision(1));
zoomInBtn.addEventListener("click", () => setMainZoomPercent(state.mainZoomPercent + MAIN_ZOOM_STEP));
zoomOutBtn.addEventListener("click", () => setMainZoomPercent(state.mainZoomPercent - MAIN_ZOOM_STEP));
zoomResetBtn.addEventListener("click", () => setMainZoomPercent(100));
document.getElementById("resetBtn").addEventListener("click", () => {
  chosenAnswers.clear();
  phonePath.length = 0;
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  highlightPath();
  render();
  outputBox.scrollTo({ top: 0, behavior: "smooth" });
  phoneDiagramBox.scrollTo({ top: 0, behavior: "smooth" });
});
document.getElementById("undoBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
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
openFileBtn.addEventListener("click", () => openFileInput.click());
openFileInput.addEventListener("change", async () => {
  const file = openFileInput.files[0];
  if (!file)
    return;
  if (state.watcher)
    state.watcher.close();
  state.currentName = null;
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  state.diagramScale = null;
  state.currentDecisionId = null;
  codeBox.value = await file.text();
  restoreTypeMetadata(splitEditorMetadata(codeBox.value).metadata);
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

// viewer.ts
applyMainZoom(false);
loadDiagram("accountability.mmd");
Object.assign(window, { loadDiagram, codeBox, nodeIdOf, selectEditorNode, addQuestionAfter, addBlockAfter, removeQuestion, removeBlock, addChoice, removeChoice, removeChoices, undoEditorAction, redoEditorAction, insertStaticBefore, insertDecisionBefore });
