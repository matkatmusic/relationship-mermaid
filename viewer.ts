declare const mermaid: any;
type Edge = [string, string];

// mermaid.initialize({ startOnLoad: false });
mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true });
const codeBox = document.getElementById('code') as HTMLTextAreaElement;
const diagramBox = document.getElementById('diagram')!;
const errorBox = document.getElementById('error')!;
const errorLog = document.getElementById('errorLog')!;
const statusBox = document.getElementById('status')!;
const selectBox = document.getElementById('diagramSelect') as HTMLSelectElement;
const drawer = document.getElementById('drawer')!;
const drawerToggle = document.getElementById('drawerToggle')!;
const openFileBtn = document.getElementById('openFileBtn')!;
const openFileInput = document.getElementById('openFileInput') as HTMLInputElement;
const mainBox = document.getElementById('main')!;
const outputBox = document.getElementById('output')!;
const phoneDiagramBox = document.getElementById('phoneDiagram')!;
const logBtn = document.getElementById('logBtn')!;
const logBox = document.getElementById('logBox')!;
const previousDecisionBtn = document.getElementById('previousDecisionBtn')!;
const nextDecisionBtn = document.getElementById('nextDecisionBtn')!;
const decisionCounter = document.getElementById('decisionCounter')!;
let renderId = 0;
let currentName: string | null = null;
let watcher: EventSource | null = null;
let currentBottomQ: string | undefined;
let phoneFocusNodeId: string | null = null;
let phoneFocusUsesDecisionContext = false;
const chosenAnswers = new Set();
const phonePath: string[] = []; // decision node ids clicked in phone view, in order
const MAX_PHONE_NODES = 8;
const PHONE_INNER = { width: 327, height: 514 };
const nodeActions = document.getElementById('nodeActions')!;
const selectedNodeBox = document.getElementById('selectedNode')!;
let selectedEditorNodeId: string | null = null;
let currentDecisionId: string | null = null;
const nodeInspector = document.getElementById('nodeInspector')!;
const nodeInspectorTitle = document.getElementById('nodeInspectorTitle')!;
const nodeTextInput = document.getElementById('nodeTextInput') as HTMLInputElement;
const nodeTypeRow = document.getElementById('nodeTypeRow')!;
const nodeTypeInput = document.getElementById('nodeTypeInput') as HTMLInputElement;
const nodeTypeColorRow = document.getElementById('nodeTypeColorRow')!;
const nodeTypeColorInput = document.getElementById('nodeTypeColorInput') as HTMLInputElement;
const nodeInspectorDismissBtn = document.getElementById('nodeInspectorDismissBtn')!;
const destinationRow = document.getElementById('destinationRow')!;
const destinationSelect = document.getElementById('destinationSelect') as HTMLSelectElement;
const nodeInspectorActions = document.getElementById('nodeInspectorActions')!;
const nodeInspectorControls = document.getElementById('nodeInspectorControls')!;
const nodeInspectorRemovalPreview = document.getElementById('nodeInspectorRemovalPreview')!;
const NEW_STATIC_DESTINATION = 'new-static';
const NEW_DECISION_DESTINATION = 'new-decision';
let advanceAfterDecisionText: { decisionId: string; choiceId: string } | null = null;
let focusDestinationAfterTextId: string | null = null;
let pendingRemoval: PendingRemoval | null = null;
let editorHistory: string[] = [codeBox.value];
let editorHistoryIndex = 0;
let editorActionPromise: Promise<void>;

const DEFAULT_TYPE_COLORS: Record<string, string> = {
  decision: '#f6d365',
  choice: '#9ed7a4',
  static: '#9fc5e8',
  goal: '#c9b6e4',
};
let typeColors: Record<string, string> = { ...DEFAULT_TYPE_COLORS };
let nodeTypes: Record<string, string> = {};

function viewBoxOf(svgText: string) {
  const match = svgText.match(/viewBox="[^"]*?\s([\d.]+)\s([\d.]+)"/)!;
  const [, w, h] = match;
  return { width: Number(w), height: Number(h) };
}

async function baseScale(edges: Edge[]) {
  const saved = phonePath.splice(0);
  const ids = sliceIds(edges);
  const source = chunkSource(new Set(ids), [], edges);
  phonePath.push(...saved);
  const { svg } = await mermaid.render('diagram-scale-' + (renderId++), source);
  const box = viewBoxOf(svg);
  // return Math.min(PHONE_INNER.width / box.width, PHONE_INNER.height / box.height);
  const screenWidth = phoneDiagramBox.clientWidth;
  const screenHeight = phoneDiagramBox.clientHeight;
  return Math.min(screenWidth / box.width, screenHeight / box.height);
}

function parentOf(id: string, edges: Edge[]) {
  let found: Edge | undefined;
  for (const edge of edges) {
    if (edge[1] === id) {
      found = edge;
      break;
    }
  }
  return found![0];
}

function labelOf(id: string) {
  const trimmedLines = [];
  for (const s of codeBox.value.split('\n')) {
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
  const withoutBrackets = withoutId.replace(/^[\[{(]+|[\]})]+$/g, '');
  return withoutBrackets.replace(/"/g, '');
}

function renderLog(edges: Edge[]) {
  const rows = [];
  for (let i = 0; i < phonePath.length; i++) {
    const id = phonePath[i];
    rows.push(`[${i + 1}] ${labelOf(parentOf(id, edges))}: ${labelOf(id)}`);
  }
  logBox.textContent = ['-- Decision Log for <issue> (<timestamp>) --', ...rows].join('\n');
}

function contextualDecisionSliceIds(decisionId: string, edges: Edge[]) {
  const reversed = [decisionId];
  const visited = new Set(reversed);
  let node = decisionId;
  for (;;) {
    const incoming = edges.find(([, to]) => to === node);
    if (!incoming)
      break;
    const predecessor = incoming[0];
    if (visited.has(predecessor))
      break;
    reversed.push(predecessor);
    visited.add(predecessor);
    const isPreviousDecision = predecessor.startsWith('Q_') && !predecessor.startsWith('Q_CHOICE');
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

function sliceIds(edges: Edge[]) {
  if (phoneFocusNodeId && phoneFocusUsesDecisionContext)
    return contextualDecisionSliceIds(phoneFocusNodeId, edges);
  const last = phonePath[phonePath.length - 1];
  const ids = phoneFocusNodeId
    ? [phoneFocusNodeId]
    : last
      ? [parentOf(last, edges), last]
      : [edges[0][0]];
  let node = ids[ids.length - 1];
  for (;;) {
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

// function stubIds(ids, edges) {
//   return ids
//     .flatMap(id => isAnswerId(id, edges) ? edges.filter(([from]) => from === id).map(([, to]) => to) : [])
//     .filter(to => !ids.includes(to));
// }

// function topStubIds(ids, edges, leadIns) {
//   if (!phonePath.length) return [];
//   const visible = new Set([...ids, ...leadIns]);
//   const targets = [ids[0], ...leadIns];
//   return [...new Set(edges.filter(([, to]) => targets.includes(to)).map(([from]) => from).filter(from => !visible.has(from)))];
// }

// function leadInIds(ids, edges) {
//   if (!phonePath.length) return [];
//   const found = [];
//   const queue = [...ids];
//   while (queue.length) {
//     const node = queue.shift();
//     for (const [from] of edges.filter(([, to]) => to === node)) {
//       const isStatic = !isAnswerId(from, edges) && edges.filter(([f]) => f === from).length <= 1;
//       if (!isStatic || ids.includes(from) || found.includes(from)) continue;
//       found.push(from);
//       queue.push(from);
//     }
//   }
//   return found;
// }

function leadInIds(ids: string[], siblings: string[], edges: Edge[]) {
  if ((phoneFocusNodeId && !phoneFocusUsesDecisionContext) || (!phonePath.length && !phoneFocusUsesDecisionContext))
    return [];
  const budget = MAX_PHONE_NODES - new Set([...ids, ...siblings]).size;
  const found: string[] = [];
  const queue = [...ids];
  for (;;) {
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

function siblingIds(ids: string[], edges: Edge[]) {
  if ((phoneFocusNodeId && !phoneFocusUsesDecisionContext) || (!phonePath.length && !phoneFocusUsesDecisionContext))
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

function choicesOf(id: string, edges: Edge[]) {
  const found = [];
  for (const [from, to] of edges) {
    if (from === id)
      found.push(to);
  }
  return found;
}

// function sliceSource(ids, stubs, topStubs, siblings, leadIns, bottomQ) {
//   const visible = new Set([...ids, ...leadIns]);
//   const keep = new Set([...ids, ...stubs, ...topStubs, ...siblings, ...leadIns]);
//   const top = new Set(topStubs);
//   const allStubs = [...stubs, ...topStubs];
//   const stubSet = new Set(allStubs);
//   const idOf = (line) => line.split(/[\[{(\s]/)[0];
//   const lines = [];
//   for (const raw of codeBox.value.split('\n')) {
//     const line = raw.trim();
//     if (line.startsWith('flowchart') || line.startsWith('classDef')) lines.push(line);
//     else if (line.startsWith('class ')) {
//       const [, list, name] = line.split(' ');
//       const kept = list.split(',').filter(id => visible.has(id));
//       if (kept.length) lines.push(`class ${kept.join(',')} ${name}`);
//     } else if (line.includes('-->')) {
//       const chain = line.split('-->').map(s => s.trim());
//       for (let i = 0; i + 1 < chain.length; i++) {
//         const a = chain[i], b = chain[i + 1];
//         if ((visible.has(a) && keep.has(b)) || (top.has(a) && visible.has(b)))
//           lines.push(stubs.includes(b) ? `${a} -.-> ${b}` : `${a} --> ${b}`);
//       }
//     } else if (keep.has(idOf(line)) && !stubSet.has(idOf(line))) lines.push(line);
//   }
//   for (const sibling of siblings) lines.push(`${ids[0]} -.-> ${sibling}`);
//   for (const id of allStubs) lines.push(`${id}[" "]`);
//   if (allStubs.length) {
//     lines.push('classDef stub fill:transparent,stroke:transparent,color:transparent');
//     lines.push(`class ${allStubs.join(',')} stub`);
//   }
//   if (siblings.length) {
//     lines.push('classDef unchosen fill:#eee,stroke:#bbb,color:#999');
//     lines.push(`class ${siblings.join(',')} unchosen`);
//   }
//   return lines.join('\n');
// }

function chunkSource(shown: Set<string>, siblings: string[], edges: Edge[]) {
  const initiallyHidden = [];
  for (const [a, b] of edges) {
    const aShown = shown.has(a);
    const bShown = shown.has(b);
    if (aShown !== bShown)
      initiallyHidden.push(aShown ? b : a);
  }
  let hidden = new Set(initiallyHidden);
  const dashed = (a: string, b: string) => siblings.includes(a) || siblings.includes(b) || hidden.has(a) || hidden.has(b);
  const hasShownPredecessor = (id: string) => {
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
  const idOf = (line: string) => line.split(/[\[{(\s]/)[0];
  const lines = [];
  const keptPairs: Edge[] = [];
  for (const raw of codeBox.value.split('\n')) {
    const line = raw.trim();
    const isFlowchart = line.startsWith('flowchart');
    const isClassDef = line.startsWith('classDef');
    const isFlowchartOrClassDef = isFlowchart || isClassDef;
    if (isFlowchartOrClassDef)
      lines.push(line);
    else if (line.startsWith('class ')) {
      const [, list, name] = line.split(' ');
      const kept = [];
      for (const id of list.split(',')) {
        const isShown = shown.has(id);
        const isSibling = siblings.includes(id);
        const keepId = isShown && !isSibling;
        if (keepId)
          kept.push(id);
      }
      if (kept.length)
        lines.push(`class ${kept.join(',')} ${name}`);
    }
    else if (line.includes('-->')) {
      const chain = [];
      for (const s of line.split('-->')) {
        chain.push(s.trim());
      }
      for (let i = 0; i + 1 < chain.length; i++) {
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
        lines.push(`${a} ${dashed(a, b) ? '-.->' : '-->'} ${b}`);
        keptPairs.push([a, b]);
      }
    }
    else if (shown.has(idOf(line)))
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
    lines.push('classDef stub fill:transparent,stroke:transparent,color:transparent');
    lines.push(`class ${[...hidden].join(',')} stub`);
  }
  if (siblings.length) {
    lines.push('classDef unchosen fill:#eee,stroke:#bbb,color:#999');
    lines.push(`class ${siblings.join(',')} unchosen`);
  }
  return lines.join('\n');
}

function parseEdges(text: string) {
  const edges: Edge[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const isComment = line.startsWith('%%');
    const hasArrow = line.includes('-->');
    const skipLine = isComment || !hasArrow;
    if (skipLine)
      continue;
    const ids = [];
    for (const s of line.split('-->')) {
      ids.push(s.trim());
    }
    for (let i = 0; i + 1 < ids.length; i++)
      edges.push([ids[i], ids[i + 1]]);
  }
  return edges;
}

function walkTrail(edges: Edge[]) {
  const bright = new Set<string>();
  const visited = new Set<string>();
  let node: string | undefined = edges[0][0];
  for (;;) {
    const hasNode = !!node;
    if (!hasNode)
      break;
    const notVisited = !visited.has(node!);
    if (!notVisited)
      break;
    visited.add(node!);
    bright.add(node!);
    const nextNodes = [];
    for (const [from, to] of edges) {
      if (from === node)
        nextNodes.push(to);
    }
    if (nextNodes.length <= 1) {
      node = nextNodes[0];
      continue;
    }
    let chosen: string | undefined;
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
  const svgNodes = diagramBox.querySelectorAll('g.node');
  const svgEdges = diagramBox.querySelectorAll('path.flowchart-link');
  const edges = parseEdges(codeBox.value);
  const bright = chosenAnswers.size ? walkTrail(edges) : null;
  const isDim = (id: string | undefined) => bright !== null && !bright.has(id!);
  for (const el of svgNodes)
    el.classList.toggle('dim', isDim(nodeIdOf(el)));
  for (const el of svgEdges) {
    const [from, to] = edgeEndsOf(el, edges);
    el.classList.toggle('dim', isDim(from) || isDim(to));
  }
}

function edgeEndsOf(el: Element, edges: Edge[]) {
  let found;
  for (const edge of edges) {
    if (el.id.includes('L_' + edge[0] + '_' + edge[1] + '_')) {
      found = edge;
      break;
    }
  }
  return found || [];
}

function nodeIdOf(el: Element) {
  return el.id.replace(/^.*flowchart-/, '').replace(/-\d+$/, '');
}

function isAnswerId(id: string, edges: Edge[]) {
  let matched = false;
  for (const [from, to] of edges) {
    const targetsId = to === id;
    const fromIsQuestion = from.startsWith('Q_');
    const idIsAnswerOfFrom = id.startsWith('Q_CHOICE_' + from.replace(/^Q_/, '') + '_');
    const isMatch = targetsId && fromIsQuestion && idIsAnswerOfFrom;
    if (isMatch) {
      matched = true;
      break;
    }
  }
  return matched;
}

function scrollToNextQuestion(edges: Edge[]) {
  const bright = [...walkTrail(edges)];
  bright.reverse();
  let nextQuestion;
  for (const id of bright) {
    const isQuestion = id.startsWith('Q_');
    const isAnswer = isAnswerId(id, edges);
    const isUnansweredQuestion = isQuestion && !isAnswer;
    if (isUnansweredQuestion) {
      nextQuestion = id;
      break;
    }
  }
  if (!nextQuestion)
    return;
  const el = diagramBox.querySelector('[id*="flowchart-' + nextQuestion + '-"]');
  if (el)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showEditorValidationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  errorBox.textContent = message;
  errorLog.textContent = message + '\n';
  errorLog.classList.add('open');
  errorLog.scrollTop = errorLog.scrollHeight;
}

function decisionNodes(graph: EditorGraph) {
  // editorGraph only exposes validated, standalone declarations. A question is
  // therefore exactly a standalone brace-shaped decision for navigation.
  return [...graph.nodes.values()]
    .filter(node => node.kind === 'question')
    .sort((a, b) => a.lineIndex - b.lineIndex);
}

function updateDecisionCounter(graph: EditorGraph) {
  const decisions = decisionNodes(graph);
  if (decisions.length === 0) {
    currentDecisionId = null;
    decisionCounter.textContent = '0 / 0';
    return decisions;
  }
  if (!decisions.some(node => node.id === currentDecisionId)) {
    const selectedDecision = decisions.find(node => node.id === selectedEditorNodeId);
    currentDecisionId = selectedDecision?.id ?? decisions[0].id;
  }
  const current = decisions.findIndex(node => node.id === currentDecisionId) + 1;
  decisionCounter.textContent = `${current} / ${decisions.length}`;
  return decisions;
}

function centerNodeInViewport(container: HTMLElement, diagram: Element, id: string) {
  const node = diagram.querySelector('[id*="flowchart-' + id + '-"]');
  if (!node)
    return;
  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  container.scrollLeft += nodeRect.left + nodeRect.width / 2 - containerRect.left - container.clientWidth / 2;
  container.scrollTop += nodeRect.top + nodeRect.height / 2 - containerRect.top - container.clientHeight / 2;
}

async function navigateDecision(step: 1 | -1) {
  let graph: EditorGraph;
  try {
    graph = editorGraph();
  }
  catch (error) {
    showEditorValidationError(error);
    return;
  }
  const decisions = updateDecisionCounter(graph);
  if (decisions.length === 0) {
    setStatus('No decisions in this diagram');
    return;
  }
  const currentIndex = decisions.findIndex(node => node.id === currentDecisionId);
  const nextIndex = (currentIndex + step + decisions.length) % decisions.length;
  const decision = decisions[nextIndex];
  currentDecisionId = decision.id;
  phoneFocusNodeId = decision.id;
  phoneFocusUsesDecisionContext = true;
  selectEditorNode(decision.id);
  updateDecisionCounter(graph);
  await render();
  centerNodeInViewport(outputBox, diagramBox, decision.id);
}

type EditorNodeKind = 'question' | 'block' | 'choice';

const INSPECTOR_TITLES: Record<EditorNodeKind, string> = { question: 'Decision block', block: 'static block', choice: 'choice block' };

interface EditorNode {
  id: string;
  kind: EditorNodeKind;
  label: string;
  lineIndex: number;
}

interface EditorEdge {
  from: string;
  to: string;
  label?: string;
  lineIndex: number;
}

interface EditorGraph {
  lines: string[];
  nodes: Map<string, EditorNode>;
  edges: EditorEdge[];
}

class EditorValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid diagram:\n${problems.join('\n')}`);
    this.name = 'EditorValidationError';
  }
}

interface PendingRemoval {
  questionId: string;
  choices: string[];
  index: number;
}

interface EditorMetadata {
  lastSelectedNodeId: string | null;
  outputScrollLeft: number;
  outputScrollTop: number;
  typeColors?: Record<string, string>;
  nodeTypes?: Record<string, string>;
}

const EDITOR_METADATA_FENCE = '%%%%====';
const EDITOR_METADATA_WARNING = 'DO NOT MODIFY - AUTOMATICALLY GENERATED DURING EVERY SAVE';

function splitEditorMetadata(source: string) {
  const headerPattern = /(?:^|\r?\n)%%%%====\r?\n%% DO NOT MODIFY - AUTOMATICALLY GENERATED DURING EVERY SAVE\r?\n%% (\{[^\r\n]*\})\r?\n%%%%====/g;
  const matches = [...source.matchAll(headerPattern)];
  if (matches.length === 0)
    return { source, metadata: null as EditorMetadata | null };
  let metadata: EditorMetadata | null = null;
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1]);
    if (typeof parsed.lastSelectedNodeId === 'string' || parsed.lastSelectedNodeId === null) {
      if (typeof parsed.outputScrollLeft === 'number' && typeof parsed.outputScrollTop === 'number') {
        metadata = {
          lastSelectedNodeId: parsed.lastSelectedNodeId,
          outputScrollLeft: parsed.outputScrollLeft,
          outputScrollTop: parsed.outputScrollTop,
          typeColors: stringRecord(parsed.typeColors),
          nodeTypes: stringRecord(parsed.nodeTypes),
        };
      }
    }
  }
  catch {
    // A malformed generated trailer is discarded and replaced on the next save.
  }
  return { source: source.replace(headerPattern, '').replace(/\s+$/, ''), metadata };
}

function sourceWithEditorMetadata(source: string) {
  const body = splitEditorMetadata(source).source;
  const metadata: EditorMetadata = {
    lastSelectedNodeId: selectedEditorNodeId,
    outputScrollLeft: outputBox.scrollLeft,
    outputScrollTop: outputBox.scrollTop,
    typeColors,
    nodeTypes,
  };
  return `${body}\n${EDITOR_METADATA_FENCE}\n%% ${EDITOR_METADATA_WARNING}\n%% ${JSON.stringify(metadata)}\n${EDITOR_METADATA_FENCE}`;
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string')
      result[key] = entry;
  }
  return result;
}

function restoreTypeMetadata(metadata: EditorMetadata | null) {
  typeColors = { ...DEFAULT_TYPE_COLORS, ...(metadata?.typeColors ?? {}) };
  nodeTypes = { ...(metadata?.nodeTypes ?? {}) };
}

function setEditorActionPromise(promise: Promise<void>) {
  editorActionPromise = promise;
  (window as any).editorActionPromise = promise;
}

setEditorActionPromise(Promise.resolve());

function stripEditorQuotes(text: string) {
  return text.replace(/^"(.*)"$/, '$1');
}

function parseEditorToken(token: string) {
  const match = token.match(/^([A-Za-z0-9_]+)([\s\S]*)$/);
  if (!match)
    return { id: token, shape: null as null | 'brace' | 'rect' | 'other', label: '' };
  const id = match[1];
  const rest = match[2].trim();
  if (rest.startsWith('{') && rest.endsWith('}'))
    return { id, shape: 'brace' as const, label: stripEditorQuotes(rest.slice(1, -1)) };
  if (rest.startsWith('([') && rest.endsWith('])'))
    return { id, shape: 'other' as const, label: stripEditorQuotes(rest.slice(2, -2)) };
  if (rest.startsWith('[') && rest.endsWith(']'))
    return { id, shape: 'rect' as const, label: stripEditorQuotes(rest.slice(1, -1)) };
  return { id, shape: null as null | 'brace' | 'rect' | 'other', label: '' };
}

function declarationRequirement(id: string) {
  if (id.startsWith('Q_CHOICE'))
    return 'start with "Q_CHOICE" and use bracket shape []';
  if (id.startsWith('Q_'))
    return 'start with "Q_" and use brace shape {}';
  if (id.startsWith('B_'))
    return 'start with "B_" and use bracket shape []';
  return 'use "Q_" with brace shape {} for a decision, "Q_CHOICE" with bracket shape [] for a choice, or "B_" with bracket shape [] for a static block';
}

function validateDeclaration(id: string, shape: 'brace' | 'rect' | 'other', lineNumber: number, problems: string[]) {
  const subject = `Line ${lineNumber}: id "${id}"`;
  if (shape === 'other') {
    problems.push(`${subject} uses unsupported rounded/stadium shape; it must ${declarationRequirement(id)}.`);
    return;
  }
  if (id.startsWith('Q_CHOICE')) {
    if (shape !== 'rect')
      problems.push(`${subject} is a choice and must use bracket shape [] (for example, ${id}["Choice"]).`);
    return;
  }
  if (id.startsWith('Q_')) {
    if (shape !== 'brace')
      problems.push(`${subject} is a decision and must use brace shape {} (for example, ${id}{"Decision"}).`);
    return;
  }
  if (id.startsWith('B_')) {
    if (shape !== 'rect')
      problems.push(`${subject} is a static block and must use bracket shape [] (for example, ${id}["Block"]).`);
    return;
  }
  problems.push(`${subject} has a non-compliant prefix; it must ${declarationRequirement(id)}.`);
}

function parseEditorEdgeLine(line: string) {
  // Mermaid permits an arbitrary number of edge segments on one physical line
  // (for example, `A --> B --> C`). Keep each segment separate so editor
  // actions operate on the same graph that Mermaid renders.
  const separator = /\s--\s(?:"([^"]*)"|(.+?))\s-->\s|\s-->/g;
  const tokens: string[] = [];
  const labels: (string | undefined)[] = [];
  let tokenStart = 0;
  for (let match; (match = separator.exec(line));) {
    tokens.push(line.slice(tokenStart, match.index).trim());
    labels.push(match[1] ?? match[2]?.trim());
    tokenStart = match.index + match[0].length;
  }
  if (tokens.length === 0)
    return null;
  tokens.push(line.slice(tokenStart).trim());
  if (tokens.some(token => !token))
    return null;
  return tokens.slice(0, -1).map((fromToken, index) => ({ fromToken, label: labels[index], toToken: tokens[index + 1] }));
}

function declarationSuffixOf(node: EditorNode) {
  if (node.kind === 'question')
    return `{"${node.label}"}`;
  if (node.kind === 'choice')
    return `["${node.label}"]`;
  return `["${node.label}"]`;
}

function editorGraph(): EditorGraph {
  const lines = codeBox.value.split('\n');
  const declLines = new Map<string, { shape: 'brace' | 'rect' | 'other'; label: string; lineIndex: number }>();
  const edges: EditorEdge[] = [];
  const references = new Map<string, number>();
  const problems: string[] = [];
  const recordDecl = (token: ReturnType<typeof parseEditorToken>, lineIndex: number) => {
    if (token.shape && !declLines.has(token.id))
      declLines.set(token.id, { shape: token.shape, label: token.label, lineIndex });
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    const isSkippable = !line || line.startsWith('flowchart') || line.startsWith('classDef') || line.startsWith('class ') || line.startsWith('%%');
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
    }
    else {
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
  const nodes = new Map<string, EditorNode>();
  for (const [id, decl] of declLines) {
    const kind: EditorNodeKind = id.startsWith('Q_CHOICE')
      ? 'choice'
      : id.startsWith('Q_')
        ? 'question'
        : 'block';
    nodes.set(id, { id, kind, label: decl.label, lineIndex: decl.lineIndex });
  }
  return { lines, nodes, edges };
}

function editorNodeKind(id: string, graph: EditorGraph) {
  return graph.nodes.get(id)?.kind;
}

function effectiveNodeType(node: EditorNode) {
  if (node.kind === 'question')
    return 'decision';
  if (node.kind === 'choice')
    return 'choice';
  return nodeTypes[node.id]?.trim() || 'static';
}

function colorForNode(node: EditorNode) {
  return typeColors[effectiveNodeType(node)] ?? typeColors.static;
}

function applyNodeTypeColors(graph: EditorGraph) {
  for (const box of [diagramBox, phoneDiagramBox]) {
    for (const nodeEl of box.querySelectorAll('g.node')) {
      const node = graph.nodes.get(nodeIdOf(nodeEl));
      if (!node)
        continue; // Slice stubs and stale metadata entries are intentionally ignored.
      const color = colorForNode(node);
      for (const shape of nodeEl.querySelectorAll('rect, path, polygon'))
        (shape as SVGElement).style.fill = color;
    }
  }
}

async function saveTypeMetadata() {
  codeBox.value = sourceWithEditorMetadata(codeBox.value);
  await saveDiagram();
}

function commitNodeType() {
  const id = selectedEditorNodeId;
  if (!id)
    return;
  let graph: EditorGraph;
  try {
    graph = editorGraph();
  }
  catch {
    return;
  }
  const node = graph.nodes.get(id);
  if (!node || node.kind !== 'block')
    return;
  const type = nodeTypeInput.value.trim() || 'static';
  if (type === 'static')
    delete nodeTypes[id];
  else
    nodeTypes[id] = type;
  nodeTypeInput.value = type;
  applyNodeTypeColors(graph);
  setEditorActionPromise(saveTypeMetadata());
}

function commitTypeColor() {
  const id = selectedEditorNodeId;
  if (!id)
    return;
  let graph: EditorGraph;
  try {
    graph = editorGraph();
  }
  catch {
    return;
  }
  const node = graph.nodes.get(id);
  if (!node)
    return;
  typeColors[effectiveNodeType(node)] = nodeTypeColorInput.value;
  applyNodeTypeColors(graph);
  setEditorActionPromise(saveTypeMetadata());
}

function sourceWithLinesReplaced(graph: EditorGraph, removedLineIndexes: Set<number>, newLines: string[]) {
  const kept = graph.lines.filter((_, lineIndex) => !removedLineIndexes.has(lineIndex));
  return [...kept, ...newLines].join('\n');
}

function nextEditorId(prefix: string, graph: EditorGraph) {
  let n = 1;
  while (graph.nodes.has(`${prefix}_${n}`))
    n++;
  return `${prefix}_${n}`;
}

function choiceId(questionId: string, suffix: string) {
  return `Q_CHOICE_${questionId.replace(/^Q_/, '')}_${suffix}`;
}

function outgoingDestination(id: string, graph: EditorGraph) {
  return graph.edges.find(edge => edge.from === id)?.to;
}

function sourceWithOutgoingChanged(id: string, destination: string | undefined, graph: EditorGraph) {
  const removedLineIndexes = new Set<number>();
  const restoredIds = new Set<string>();
  const newLines: string[] = [];
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

function replaceOutgoing(id: string, destination: string, graph: EditorGraph) {
  return sourceWithOutgoingChanged(id, destination, graph);
}

function removeOutgoing(id: string, graph: EditorGraph) {
  return sourceWithOutgoingChanged(id, undefined, graph);
}

function preserveInlineDecl(edge: EditorEdge, keepEndpointId: string, graph: EditorGraph, newLines: string[]) {
  const node = graph.nodes.get(keepEndpointId);
  if (node && node.lineIndex === edge.lineIndex)
    newLines.push(`  ${keepEndpointId}${declarationSuffixOf(node)}`);
}

async function commitEditorSource(source: string, options?: { recordHistory?: boolean }) {
  source = sourceWithEditorMetadata(source);
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

function enqueueEditorAction(action: () => Promise<void>) {
  setEditorActionPromise(editorActionPromise.then(action));
}

function runEditorAction(action: () => Promise<void>) {
  enqueueEditorAction(action);
}

function selectEditorNode(id: string | null) {
  selectedEditorNodeId = id;
  if (advanceAfterDecisionText?.decisionId !== id)
    advanceAfterDecisionText = null;
  if (focusDestinationAfterTextId !== id)
    focusDestinationAfterTextId = null;
  pendingRemoval = null;
  nodeActions.classList.remove('removing');
  nodeActions.classList.toggle('open', !!id);
  selectedNodeBox.textContent = id ?? '';
  renderEditorSelection();
  renderNodeInspector();
}

function renderEditorSelection() {
  for (const el of diagramBox.querySelectorAll('.editor-selected'))
    el.classList.remove('editor-selected');
  for (const el of diagramBox.querySelectorAll('.editor-preview'))
    el.classList.remove('editor-preview');
  if (selectedEditorNodeId) {
    const el = diagramBox.querySelector('[id*="flowchart-' + selectedEditorNodeId + '-"]');
    if (el)
      el.classList.add('editor-selected');
  }
  if (pendingRemoval) {
    const target = pendingRemoval.choices[pendingRemoval.index];
    const el = diagramBox.querySelector('[id*="flowchart-' + target + '-"]');
    if (el)
      el.classList.add('editor-preview');
  }
}

function showRemovalPreview() {
  renderEditorSelection();
  renderNodeInspector();
}

function addQuestionAfter() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = selectedEditorNodeId;
  const removedLineIndexes = new Set<number>();
  const successors: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from !== selected)
      continue;
    successors.push(edge.to);
    removedLineIndexes.add(edge.lineIndex);
  }
  const qId = nextEditorId('Q_NEW', graph);
  const yesId = choiceId(qId, 'Y');
  const noId = choiceId(qId, 'N');
  const newLines = [
    `  ${selected} --> ${qId}`,
    `  ${qId}{"New question"}`,
    `  ${yesId}["Yes"]`,
    `  ${noId}["No"]`,
    `  ${qId} --> ${yesId}`,
    `  ${qId} --> ${noId}`,
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
  const removedLineIndexes = new Set<number>();
  const successors: string[] = [];
  const newLines: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from !== selected)
      continue;
    successors.push(edge.to);
    removedLineIndexes.add(edge.lineIndex);
    preserveInlineDecl(edge, edge.to, graph, newLines);
  }
  const bId = nextEditorId('B_NEW', graph);
  newLines.unshift(`  ${selected} --> ${bId}`, `  ${bId}["New block"]`);
  for (const successor of successors)
    newLines.push(`  ${bId} --> ${successor}`);
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}

function insertStaticBefore() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = selectedEditorNodeId;
  const selectedNode = graph.nodes.get(selected)!;
  const removedLineIndexes = new Set<number>();
  const predecessors: EditorEdge[] = [];
  for (const edge of graph.edges) {
    if (edge.to !== selected)
      continue;
    predecessors.push(edge);
    removedLineIndexes.add(edge.lineIndex);
  }
  const staticId = nextEditorId('B_NEW', graph);
  const newLines: string[] = [`  ${staticId}["New static block"]`];
  const restoredInlineDecls = new Set<string>();
  const restoreInlineDecl = (edge: EditorEdge, endpointId: string) => {
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
  // Removing one segment of a chained edge line removes the whole physical
  // line. Recreate every other segment from that line, including any inline
  // declarations it carried.
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
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = selectedEditorNodeId;
  const selectedNode = graph.nodes.get(selected)!;
  const removedLineIndexes = new Set<number>();
  const predecessors: EditorEdge[] = [];
  for (const edge of graph.edges) {
    if (edge.to !== selected)
      continue;
    predecessors.push(edge);
    removedLineIndexes.add(edge.lineIndex);
  }
  const decisionId = nextEditorId('Q_NEW', graph);
  const newChoiceId = choiceId(decisionId, 'NEW');
  const newLines: string[] = [
    `  ${decisionId}{"New Decision"}`,
    `  ${newChoiceId}["New choice"]`,
    `  ${decisionId} --> ${newChoiceId}`,
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

function choiceSuffixFromLabel(label: string) {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'CHOICE';
}

function addChoice() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = selectedEditorNodeId;
  const labelled = graph.edges.find(e => e.from === questionId && e.label);
  const removedLineIndexes = new Set<number>();
  const newLines: string[] = [];
  if (labelled) {
    removedLineIndexes.add(labelled.lineIndex);
    const suffix = choiceSuffixFromLabel(labelled.label!);
    const cid = choiceId(questionId, suffix);
    const targetSuffix = (() => {
      const node = graph.nodes.get(labelled.to);
      return node && node.lineIndex === labelled.lineIndex ? declarationSuffixOf(node) : '';
    })();
    newLines.push(
      `  ${cid}["${labelled.label}"]`,
      `  ${questionId} --> ${cid}`,
      `  ${cid} --> ${labelled.to}${targetSuffix}`,
    );
  }
  else {
    let suffix = 'NEW';
    let n = 1;
    while (graph.nodes.has(choiceId(questionId, suffix)))
      suffix = 'NEW' + (++n);
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
  const removedLineIndexes = new Set<number>();
  const newLines: string[] = [];
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
  const removedLineIndexes = new Set<number>();
  const newLines: string[] = [];
  const predecessors: string[] = [];
  const successors: string[] = [];
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
    }
    else {
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
  const choices: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from === questionId)
      choices.push(edge.to);
  }
  if (!choices.length)
    return;
  pendingRemoval = { questionId, choices, index: 0 };
  nodeActions.classList.add('removing');
  showRemovalPreview();
}

function removeChoices() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = selectedEditorNodeId;
  const removedLineIndexes = new Set<number>();
  const newLines: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from !== questionId)
      continue;
    removedLineIndexes.add(edge.lineIndex);
    const targetNode = graph.nodes.get(edge.to);
    const isImmediateChoice = targetNode?.kind === 'choice';
    if (!isImmediateChoice) {
      preserveInlineDecl(edge, edge.to, graph, newLines);
      continue;
    }
    const choiceNodeId = edge.to;
    removedLineIndexes.add(targetNode!.lineIndex);
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
  const removedLineIndexes = new Set<number>();
  const newLines: string[] = [];
  const qNode = graph.nodes.get(questionId);
  if (qNode)
    removedLineIndexes.add(qNode.lineIndex);
  const predecessors: string[] = [];
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
    const isImmediateChoice = targetNode?.kind === 'choice';
    if (!isImmediateChoice) {
      preserveInlineDecl(edge, edge.to, graph, newLines);
      continue;
    }
    removedLineIndexes.add(targetNode!.lineIndex);
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

function replaceDeclarationInLine(line: string, id: string, newToken: string) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escapedId}(\\{[^}]*\\}|\\[[^\\]]*\\]|\\(\\[[^\\]]*\\]\\))`);
  return line.replace(re, newToken);
}

// function beginInlineEdit(nodeEl: Element, id: string, kind: EditorNodeKind) {
//   const label = nodeEl.querySelector('.nodeLabel') as HTMLElement | null;
//   if (!label)
//     return;
//   label.contentEditable = 'true';
//   label.focus();
//   let committed = false;
//   const commit = () => {
//     if (committed)
//       return;
//     committed = true;
//     label.contentEditable = 'false';
//     const text = (label.textContent ?? '').trim();
//     const graph = editorGraph();
//     const node = graph.nodes.get(id);
//     if (!node)
//       return;
//     const newToken = kind === 'question' ? `${id}{"${text}"}` : `${id}["${text}"]`;
//     const lines = graph.lines.slice();
//     lines[node.lineIndex] = replaceDeclarationInLine(lines[node.lineIndex], id, newToken);
//     runEditorAction(() => commitEditorSource(lines.join('\n')));
//   };
//   label.addEventListener('keydown', (event) => {
//     if ((event as KeyboardEvent).key !== 'Enter')
//       return;
//     event.preventDefault();
//     commit();
//   });
//   label.addEventListener('blur', commit, { once: true });
// }

function inspectorActionButton(action: string, label: string, spanTwoColumns = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.textContent = label;
  button.classList.toggle('span-2', spanTwoColumns);
  return button;
}

function renderNodeInspector() {
  let graph: EditorGraph;
  try {
    graph = editorGraph();
  }
  catch {
    nodeInspector.hidden = true;
    return;
  }
  const node = graph.nodes.get(selectedEditorNodeId ?? '');
  nodeInspector.hidden = !node;
  if (!node)
    return;
  const previewing = !!pendingRemoval;
  nodeInspectorTitle.textContent = INSPECTOR_TITLES[node.kind];
  nodeTextInput.value = node.label;
  const nodeType = effectiveNodeType(node);
  nodeTypeRow.hidden = previewing || node.kind !== 'block';
  nodeTypeColorRow.hidden = previewing;
  nodeTypeInput.value = node.kind === 'block' ? nodeType : '';
  nodeTypeColorInput.value = colorForNode(node);
  nodeInspectorRemovalPreview.hidden = !previewing;
  nodeInspectorActions.hidden = previewing;
  nodeInspectorControls.hidden = previewing;
  if (previewing) {
    positionNodeInspector();
    return;
  }
  const actions: HTMLButtonElement[] = [inspectorActionButton('remove', 'Remove')];
  if (node.kind === 'question')
    actions.push(
      inspectorActionButton('add-choice', 'Add choice'),
      inspectorActionButton('remove-choices', 'Remove choices'),
      inspectorActionButton('insert-static-before', 'insert static block before'),
      inspectorActionButton('insert-decision-before', 'insert Decision & leading choice before'),
    );
  else if (node.kind === 'block')
    actions.push(
      inspectorActionButton('add-decision-after', 'add Decision block after'),
      inspectorActionButton('insert-decision-after', 'Insert decision block after'),
      inspectorActionButton('insert-static-after', 'Insert static block after'),
      inspectorActionButton('insert-static-before', 'insert static block before'),
      inspectorActionButton('insert-decision-before', 'insert Decision & leading choice before'),
    );
  else if (node.kind === 'choice')
    actions.push(
      inspectorActionButton('add-decision-after', 'add Decision block after'),
      inspectorActionButton('add-static-after', 'add static block after'),
      inspectorActionButton('insert-decision-after', 'Insert decision block after'),
      inspectorActionButton('insert-static-after', 'Insert static block after'),
    );
  nodeInspectorActions.replaceChildren(...actions);
  const hasDestination = node.kind !== 'question';
  destinationRow.hidden = !hasDestination;
  destinationSelect.replaceChildren();
  if (hasDestination) {
    destinationSelect.add(new Option('Terminal', ''));
    destinationSelect.add(new Option('New static block', NEW_STATIC_DESTINATION));
    destinationSelect.add(new Option('New Decision block', NEW_DECISION_DESTINATION));
    const destination = outgoingDestination(node.id, graph);
    for (const candidate of graph.nodes.values()) {
      const isSelf = candidate.id === node.id;
      const isHiddenChoice = candidate.kind === 'choice' && candidate.id !== destination;
      if (isSelf || isHiddenChoice)
        continue;
      destinationSelect.add(new Option(`${candidate.label} (${candidate.id})`, candidate.id));
    }
    destinationSelect.value = destination ?? '';
    nodeInspectorDismissBtn.textContent = destination ? 'Cancel' : 'Close';
  }
  else {
    nodeInspectorDismissBtn.textContent = 'Cancel';
  }
  positionNodeInspector();
}

function positionNodeInspector() {
  if (nodeInspector.hidden)
    return;
  const drawerRect = drawer.getBoundingClientRect();
  const mainRect = mainBox.getBoundingClientRect();
  nodeInspector.style.width = '';
  nodeInspector.style.left = drawerRect.right + 'px';
  nodeInspector.style.top = mainRect.top + 'px';
}

function focusInspectorText() {
  nodeTextInput.focus();
  nodeTextInput.select();
}

function focusInspectorDestination() {
  destinationSelect.focus();
}

async function commitNewStaticAfter(sourceId: string, graph: EditorGraph) {
  const staticId = nextEditorId('B_NEW', graph);
  const source = `${replaceOutgoing(sourceId, staticId, graph)}\n  ${staticId}["New static block"]`;
  await commitEditorSource(source);
  focusDestinationAfterTextId = staticId;
  selectEditorNode(staticId);
  focusInspectorText();
}

async function commitInsertStaticAfter(sourceId: string, graph: EditorGraph) {
  const staticId = nextEditorId('B_NEW', graph);
  const oldDestination = outgoingDestination(sourceId, graph);
  const newLines = [`  ${staticId}["New static block"]`];
  if (oldDestination)
    newLines.push(`  ${staticId} --> ${oldDestination}`);
  const source = `${replaceOutgoing(sourceId, staticId, graph)}\n${newLines.join('\n')}`;
  await commitEditorSource(source);
  focusDestinationAfterTextId = staticId;
  selectEditorNode(staticId);
  focusInspectorText();
}

async function commitInsertDecisionAfter(sourceId: string, graph: EditorGraph) {
  const removedLineIndexes = new Set<number>();
  const successors: EditorEdge[] = [];
  for (const edge of graph.edges) {
    if (edge.from !== sourceId)
      continue;
    successors.push(edge);
    removedLineIndexes.add(edge.lineIndex);
  }
  const decisionId = nextEditorId('Q_NEW', graph);
  const yesId = choiceId(decisionId, 'Y');
  const noId = choiceId(decisionId, 'N');
  const newLines = [
    `  ${decisionId}{"New Decision"}`,
    `  ${yesId}["Yes"]`,
    `  ${noId}["No"]`,
    `  ${sourceId} --> ${decisionId}`,
    `  ${decisionId} --> ${yesId}`,
    `  ${decisionId} --> ${noId}`,
  ];
  const restoredInlineDecls = new Set<string>();
  const restoreInlineDecl = (edge: EditorEdge, endpointId: string) => {
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
  // Replacing one segment of a chained edge removes its entire physical line.
  // Restore every unaffected segment so the insertion changes only sourceId's tail.
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

async function commitNewDecisionAfter(sourceId: string, graph: EditorGraph) {
  await commitInsertDecisionAfter(sourceId, graph);
}

async function commitAddChoiceOnDecision(questionId: string, graph: EditorGraph) {
  const removedLineIndexes = new Set<number>();
  let suffix = 'NEW';
  let n = 1;
  while (graph.nodes.has(choiceId(questionId, suffix)))
    suffix = 'NEW' + (++n);
  const cid = choiceId(questionId, suffix);
  const newLines = [`  ${cid}["New choice"]`, `  ${questionId} --> ${cid}`];
  await commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines));
  selectEditorNode(questionId);
}

function addChoiceOnDecision() {
  if (!selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = selectedEditorNodeId;
  setEditorActionPromise(commitAddChoiceOnDecision(questionId, graph));
}

function commitNodeText(id = selectedEditorNodeId, text = nodeTextInput.value.trim()) {
  if (!id)
    return;
  const advance = advanceAfterDecisionText?.decisionId === id ? advanceAfterDecisionText : null;
  const focusDestination = focusDestinationAfterTextId === id;
  if (advance)
    advanceAfterDecisionText = null;
  if (focusDestination)
    focusDestinationAfterTextId = null;
  enqueueEditorAction(async () => {
    const graph = editorGraph();
    const node = graph.nodes.get(id);
    if (!node)
      return;
    if (node.label !== text) {
      const newToken = node.kind === 'question' ? `${id}{"${text}"}` : `${id}["${text}"]`;
      const lines = graph.lines.slice();
      lines[node.lineIndex] = replaceDeclarationInLine(lines[node.lineIndex], id, newToken);
      await commitEditorSource(lines.join('\n'));
    }
    if (advance) {
      selectEditorNode(advance.choiceId);
      focusInspectorDestination();
    }
    else if (focusDestination) {
      selectEditorNode(id);
      focusInspectorDestination();
    }
  });
}

function applyDestination(destination: string) {
  const id = selectedEditorNodeId;
  if (!id)
    return;
  const graph = editorGraph();
  const node = graph.nodes.get(id);
  if (!node || node.kind === 'question')
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
      const source = destination
        ? replaceOutgoing(id, destination, currentGraph)
        : removeOutgoing(id, currentGraph);
      await commitEditorSource(source);
    }
  });
}

function commitDestination() {
  applyDestination(destinationSelect.value);
}

outputBox.addEventListener('click', (event) => {
  const nodeEl = (event.target as HTMLElement).closest('g.node');
  const id = nodeEl ? nodeIdOf(nodeEl) : null;
  selectEditorNode(id);
  if (id) {
    phoneFocusNodeId = id;
    phoneFocusUsesDecisionContext = false;
    render();
  }
});

phoneDiagramBox.addEventListener('click', (event) => {
  const nodeEl = (event.target as HTMLElement).closest('g.node');
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
  phoneFocusNodeId = null;
  phoneFocusUsesDecisionContext = false;
  render();
});

outputBox.addEventListener('dblclick', (event) => {
  const nodeEl = (event.target as HTMLElement).closest('g.node');
  if (!nodeEl)
    return;
  selectEditorNode(nodeIdOf(nodeEl));
  nodeTextInput.focus();
  nodeTextInput.select();
});

document.getElementById('addQuestionAfterBtn')!.addEventListener('click', addQuestionAfter);
document.getElementById('addBlockAfterBtn')!.addEventListener('click', addBlockAfter);
document.getElementById('removeQuestionBtn')!.addEventListener('click', removeQuestion);
document.getElementById('removeBlockBtn')!.addEventListener('click', removeBlock);
document.getElementById('addChoiceBtn')!.addEventListener('click', addChoice);
document.getElementById('removeChoiceBtn')!.addEventListener('click', removeChoice);
document.getElementById('nextRemovalPathBtn')!.addEventListener('click', advanceRemovalPreview);
document.getElementById('confirmRemoveQuestionBtn')!.addEventListener('click', confirmQuestionRemoval);
document.getElementById('cancelRemoveQuestionBtn')!.addEventListener('click', cancelQuestionRemoval);
document.getElementById('editorUndoBtn')!.addEventListener('click', undoEditorAction);
document.getElementById('editorRedoBtn')!.addEventListener('click', redoEditorAction);
document.getElementById('nodeInspectorDismissBtn')!.addEventListener('click', () => selectEditorNode(null));
destinationSelect.addEventListener('change', commitDestination);
nodeInspectorActions.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  const action = button?.dataset.action;
  if (action === 'add-static-after')
    applyDestination(NEW_STATIC_DESTINATION);
  else if (action === 'insert-static-after') {
    if (!selectedEditorNodeId)
      return;
    setEditorActionPromise(commitInsertStaticAfter(selectedEditorNodeId, editorGraph()));
  }
  else if (action === 'insert-decision-after') {
    if (!selectedEditorNodeId)
      return;
    setEditorActionPromise(commitInsertDecisionAfter(selectedEditorNodeId, editorGraph()));
  }
  else if (action === 'add-decision-after')
    applyDestination(NEW_DECISION_DESTINATION);
  else if (action === 'add-choice')
    addChoiceOnDecision();
  else if (action === 'remove') {
    const kind = editorGraph().nodes.get(selectedEditorNodeId ?? '')?.kind;
    if (kind === 'question')
      removeQuestion();
    else if (kind === 'block')
      removeBlock();
    else if (kind === 'choice')
      removeChoice();
  }
  else if (action === 'remove-choices')
    removeChoices();
  else if (action === 'insert-static-before')
    insertStaticBefore();
  else if (action === 'insert-decision-before')
    insertDecisionBefore();
});
nodeTextInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter')
    return;
  event.preventDefault();
  commitNodeText();
});
nodeTypeInput.addEventListener('change', commitNodeType);
nodeTypeColorInput.addEventListener('change', commitTypeColor);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape')
    return;
  selectEditorNode(null);
});
outputBox.addEventListener('scroll', positionNodeInspector);
window.addEventListener('resize', positionNodeInspector);

// function updateSvgSizingForPhoneMode() {
//   const svg = diagramBox.querySelector('svg');
//   if (!svg) return;
//   if (!outputBox.classList.contains('phone')) {
//     svg.style.width = '';
//     svg.style.height = '';
//     return;
//   }
//   const viewBox = svg.getAttribute('viewBox');
//   if (!viewBox) return;
//   const [, , vbWidth, vbHeight] = viewBox.split(' ').map(Number);
//   svg.style.width = vbWidth + 'px';
//   svg.style.height = vbHeight + 'px';
// }

// function drawSeparator(ids) {
//   if (!phonePath.length || ids.length < 3) return;
//   const svg = diagramBox.querySelector('svg');
//   const nodeEl = (id) => diagramBox.querySelector('[id*="flowchart-' + id + '-"]');
//   const yOf = (el) => Number(el.getAttribute('transform').match(/translate\([^,]+,\s*([^)]+)\)/)[1]);
//   const chosen = nodeEl(ids[1]);
//   const next = nodeEl(ids[2]);
//   const chosenBottom = yOf(chosen) + chosen.getBBox().height / 2;
//   const nextTop = yOf(next) - next.getBBox().height / 2;
//   const [x, , width] = svg.getAttribute('viewBox').split(' ').map(Number);
//   const y = (chosenBottom + nextTop) / 2;
//   const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
//   line.setAttribute('x1', x); line.setAttribute('x2', x + width);
//   line.setAttribute('y1', y); line.setAttribute('y2', y);
//   line.setAttribute('stroke', '#888'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '8 6');
//   line.setAttribute('class', 'separator');
//   svg.appendChild(line);
// }

function drawSeparatorBetween(topId: string, belowIds: string[], label: string) {
  const svg = phoneDiagramBox.querySelector('svg')!;
  const nodeEl = (id: string) => phoneDiagramBox.querySelector('[id*="flowchart-' + id + '-"]') as SVGGraphicsElement | null;
  const yOf = (el: SVGGraphicsElement) => Number(el.getAttribute('transform')!.match(/translate\([^,]+,\s*([^)]+)\)/)![1]);
  const top = nodeEl(topId);
  const belowEls: SVGGraphicsElement[] = [];
  for (const id of belowIds) {
    const el = nodeEl(id);
    if (el)
      belowEls.push(el);
  }
  const hasTopAndBelow = top && belowEls.length;
  if (!hasTopAndBelow)
    return;
  const topBottom = yOf(top!) + top!.getBBox().height / 2;
  const belowTops = [];
  for (const el of belowEls) {
    belowTops.push(yOf(el) - el.getBBox().height / 2);
  }
  const belowTop = Math.min(...belowTops);
  const viewBoxParts = svg.getAttribute('viewBox')!.split(' ');
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, , width] = viewBoxNumbers;
  const y = (topBottom + belowTop) / 2;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  // ponytail: overshoot the viewBox so the line spans the whole phone width; the svg clips it
  // line.setAttribute('x1', String(x - 10000)); line.setAttribute('x2', String(x + width + 10000));
  // line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
  // line.setAttribute('stroke', '#888'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '8 6');
  const lineAttrs: [string, string][] = [
    ['x1', String(x - 10000)],
    ['x2', String(x + width + 10000)],
    ['y1', String(y)],
    ['y2', String(y)],
    ['stroke', '#888'],
    ['stroke-width', '2'],
    ['stroke-dasharray', '8 6'],
  ];
  for (const [name, value] of lineAttrs) {
    line.setAttribute(name, value);
  }
  line.setAttribute('class', 'separator');
  svg.appendChild(line);
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  const screenToSvg = svg.getScreenCTM()!.inverse();
  const svgLeft = new DOMPoint(svg.getBoundingClientRect().left, 0).matrixTransform(screenToSvg).x;
  // text.setAttribute('x', String(x + 8));
  text.setAttribute('x', String(svgLeft + 8));
  text.setAttribute('y', String(y - 6));
  // text.setAttribute('font-size', '14');
  // text.setAttribute('fill', '#333');
  const isOpenDecision = label === 'open decision';
  const fill = isOpenDecision ? '#2e7d32' : '#c62828';
  text.setAttribute('fill', fill);
  text.setAttribute('stroke', '#000');
  text.setAttribute('stroke-width', '0.6');
  text.setAttribute('paint-order', 'stroke');
  text.setAttribute('font-weight', 'bold');
  text.setAttribute('font-size', '16');
  text.setAttribute('font-family', 'sans-serif');
  text.setAttribute('class', 'separator-label');
  text.textContent = label;
  svg.appendChild(text);
}

function drawLastDecisionMask(ids: string[], edges: Edge[]): void {
  const svg = phoneDiagramBox.querySelector('svg')!;
  const nodeEl = (id: string) => phoneDiagramBox.querySelector('[id*="flowchart-' + id + '-"]') as SVGGraphicsElement | null;
  const yOf = (el: SVGGraphicsElement) => Number(el.getAttribute('transform')!.match(/translate\([^,]+,\s*([^)]+)\)/)![1]);
  const top = nodeEl(ids[0]);
  const choiceEls: SVGGraphicsElement[] = [];
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
  const viewBoxParts = svg.getAttribute('viewBox')!.split(' ');
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, y, width] = viewBoxNumbers;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x - 10000));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(width + 20000));
  rect.setAttribute('height', String(maskBottom - y));
  rect.setAttribute('fill', 'rgba(0,0,0,0.25)');
  rect.setAttribute('class', 'last-decision-mask');
  rect.setAttribute('pointer-events', 'none');
  svg.appendChild(rect);
}

function drawSeparator(ids: string[], leadIns: string[]) {
  const svg = phoneDiagramBox.querySelector('svg')!;
  const nodeEl = (id: string) => phoneDiagramBox.querySelector('[id*="flowchart-' + id + '-"]') as SVGGraphicsElement | null;
  const yOf = (el: SVGGraphicsElement) => Number(el.getAttribute('transform')!.match(/translate\([^,]+,\s*([^)]+)\)/)![1]);
  const topDp = nodeEl(ids[0]);
  if (!topDp)
    return;
  const topOfDp = yOf(topDp) - topDp.getBBox().height / 2;
  const leadInEls: SVGGraphicsElement[] = [];
  for (const id of leadIns) {
    const el = nodeEl(id);
    if (el)
      leadInEls.push(el);
  }
  const above: SVGGraphicsElement[] = [];
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
  const viewBoxParts = svg.getAttribute('viewBox')!.split(' ');
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, , width] = viewBoxNumbers;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  // line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x + width));
  // line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
  // line.setAttribute('stroke', '#888'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '8 6');
  const lineAttrs: [string, string][] = [
    ['x1', String(x)],
    ['x2', String(x + width)],
    ['y1', String(y)],
    ['y2', String(y)],
    ['stroke', '#888'],
    ['stroke-width', '2'],
    ['stroke-dasharray', '8 6'],
  ];
  for (const [name, value] of lineAttrs) {
    line.setAttribute(name, value);
  }
  line.setAttribute('class', 'separator');
  svg.appendChild(line);
}

function scrollChoicesIntoView(bottomQ: string | undefined, edges: Edge[]): void {
  if (phoneFocusNodeId) {
    centerNodeInViewport(phoneDiagramBox, phoneDiagramBox, phoneFocusNodeId);
    return;
  }
  const atStart = phonePath.length === 0;
  if (atStart) {
    phoneDiagramBox.scrollTop = 0;
    return;
  }
  if (!bottomQ)
    return;
  let lastChoice: Element | null = null;
  for (const [from, to] of edges) {
    const isChoice = from === bottomQ;
    if (isChoice)
      lastChoice = phoneDiagramBox.querySelector('[id*="flowchart-' + to + '-"]');
  }
  if (!lastChoice)
    return;
  lastChoice.scrollIntoView({ block: 'end' });
}

async function render() {
  errorBox.textContent = '';
  try {
    // Validate before Mermaid sees the source. Invalid diagrams remain visible
    // only as their actionable editor error and cannot be edited or rendered.
    const graph = editorGraph();
    updateDecisionCounter(graph);
    const edges = parseEdges(codeBox.value);
    const ids = edges.length > 0 ? sliceIds(edges) : [];
    const siblings = siblingIds(ids, edges);
    const leadIns = leadInIds(ids, siblings, edges);
    const shown = new Set([...ids, ...siblings, ...leadIns]);
    const reversedIds = [...ids].reverse();
    let bottomQ = phoneFocusNodeId && graph.nodes.get(phoneFocusNodeId)?.kind === 'question'
      ? phoneFocusNodeId
      : undefined;
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
    currentBottomQ = bottomQ;
    const phoneSource = edges.length > 0 ? chunkSource(shown, siblings, edges) : codeBox.value;
    const regularViewport = { left: outputBox.scrollLeft, top: outputBox.scrollTop };
    const phoneViewport = { left: phoneDiagramBox.scrollLeft, top: phoneDiagramBox.scrollTop };
    const [{ svg: regularSvg }, { svg: phoneSvg }] = await Promise.all([
      mermaid.render('diagram-' + (renderId++), codeBox.value),
      mermaid.render('phone-diagram-' + (renderId++), phoneSource),
    ]);
    diagramBox.innerHTML = regularSvg;
    phoneDiagramBox.innerHTML = phoneSvg;
    applyNodeTypeColors(graph);
    renderEditorSelection();
    highlightPath();
    if (edges.length > 0) {
      const scale = await baseScale(edges);
      const regularSvgEl = diagramBox.querySelector('svg')!;
      const regularBox = viewBoxOf(regularSvg);
      regularSvgEl.style.width = regularBox.width * scale + 'px';
      regularSvgEl.style.height = regularBox.height * scale + 'px';
      const phoneSvgEl = phoneDiagramBox.querySelector('svg')!;
      const phoneBox = viewBoxOf(phoneSvg);
      const phoneWidth = Math.max(phoneBox.width * scale, phoneDiagramBox.clientWidth);
      phoneSvgEl.style.width = phoneWidth + 'px';
      phoneSvgEl.style.height = phoneBox.height * scale + 'px';
    }
    outputBox.scrollLeft = regularViewport.left;
    outputBox.scrollTop = regularViewport.top;
    phoneDiagramBox.scrollLeft = phoneViewport.left;
    phoneDiagramBox.scrollTop = phoneViewport.top;
    renderLog(edges);
    const hasContextualPreviousDecision = phoneFocusUsesDecisionContext
      && ids[0] !== phoneFocusNodeId
      && graph.nodes.get(ids[0])?.kind === 'question';
    const shouldDrawLastDecision = edges.length > 0 && (phonePath.length > 0 || hasContextualPreviousDecision);
    if (shouldDrawLastDecision)
      drawLastDecisionMask(ids, edges);
    if (shouldDrawLastDecision)
      drawSeparatorBetween(ids[0], choicesOf(ids[0], edges), 'last decision');
    const shouldDrawBottomSeparator = edges.length > 0 && bottomQ;
    if (shouldDrawBottomSeparator)
      drawSeparatorBetween(bottomQ!, choicesOf(bottomQ!, edges), 'open decision');
    if (edges.length > 0)
      scrollChoicesIntoView(bottomQ, edges);
    positionNodeInspector();
    errorLog.textContent = '';
    errorLog.classList.remove('open');
  }
  catch (err) {
    currentDecisionId = null;
    decisionCounter.textContent = '0 / 0';
    showEditorValidationError(err);
  }
}

function setStatus(text: string) {
  statusBox.textContent = text;
  setTimeout(() => {
    if (statusBox.textContent === text)
      statusBox.textContent = '';
  }, 2000);
}

function setDrawerOpen(open: boolean) {
  drawer.classList.toggle('closed', !open);
  positionNodeInspector();
}

async function loadList() {
  const names = await fetch('/api/diagrams').then(r => r.json());
  selectBox.innerHTML = '<option value="" disabled ' + (currentName ? '' : 'selected') + '>Diagrams</option>';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    if (name === currentName)
      option.selected = true;
    selectBox.appendChild(option);
  }
}

function resetEditorHistory(text: string) {
  editorHistory = [text];
  editorHistoryIndex = 0;
  selectEditorNode(null);
}

async function loadDiagram(name: string) {
  const text = await fetch('/api/diagrams/' + encodeURIComponent(name)).then(r => r.text());
  const { metadata } = splitEditorMetadata(text);
  restoreTypeMetadata(metadata);
  currentName = name;
  phoneFocusNodeId = null;
  phoneFocusUsesDecisionContext = false;
  currentDecisionId = metadata?.lastSelectedNodeId ?? null;
  codeBox.value = text;
  resetEditorHistory(text);
  await render();
  if (metadata) {
    try {
      if (editorGraph().nodes.has(metadata.lastSelectedNodeId ?? ''))
        selectEditorNode(metadata.lastSelectedNodeId);
    }
    catch {
      // render() has already surfaced the validation failure.
    }
  }
  if (metadata) {
    outputBox.scrollLeft = metadata.outputScrollLeft;
    outputBox.scrollTop = metadata.outputScrollTop;
  }
  loadList();
  watchDiagram(name);
}

function watchDiagram(name: string) {
  if (watcher)
    watcher.close();
  const source = new EventSource('/api/watch/' + encodeURIComponent(name));
  watcher = source;
  source.onmessage = async () => {
    const text = await fetch('/api/diagrams/' + encodeURIComponent(name)).then(r => r.text());
    const isStaleWatcher = watcher !== source;
    if (isStaleWatcher)
      return;
    if (text !== codeBox.value) {
      restoreTypeMetadata(splitEditorMetadata(text).metadata);
      codeBox.value = text;
      resetEditorHistory(text);
    }
    render();
  };
}

async function saveDiagram() {
  let name = currentName;
  if (!name) {
    name = prompt('Name this diagram (letters, numbers, - and _ only):');
    if (!name)
      return;
    if (!name.endsWith('.mmd'))
      name += '.mmd';
  }
  await fetch('/api/diagrams/' + encodeURIComponent(name), {
    method: 'PUT',
    body: codeBox.value,
  });
  currentName = name;
  setStatus('Saved ' + name);
  loadList();
  watchDiagram(name);
}

document.getElementById('newBtn')!.addEventListener('click', () => {
  if (watcher)
    watcher.close();
  currentName = null;
  phoneFocusNodeId = null;
  phoneFocusUsesDecisionContext = false;
  currentDecisionId = null;
  restoreTypeMetadata(null);
  codeBox.value = 'flowchart TD\n  B_NEW[New idea]';
  resetEditorHistory(codeBox.value);
  render();
  loadList();
  setDrawerOpen(true);
});
document.getElementById('saveBtn')!.addEventListener('click', saveDiagram);
previousDecisionBtn.addEventListener('click', () => navigateDecision(-1));
nextDecisionBtn.addEventListener('click', () => navigateDecision(1));
document.getElementById('resetBtn')!.addEventListener('click', () => {
  chosenAnswers.clear();
  phonePath.length = 0;
  phoneFocusNodeId = null;
  phoneFocusUsesDecisionContext = false;
  highlightPath();
  render();
  outputBox.scrollTo({ top: 0, behavior: 'smooth' });
  phoneDiagramBox.scrollTo({ top: 0, behavior: 'smooth' });
});
document.getElementById('undoBtn')!.addEventListener('click', (event) => {
  event.stopPropagation();
  phoneFocusNodeId = null;
  phoneFocusUsesDecisionContext = false;
  phonePath.pop();
  render();
});
logBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = logBox.classList.toggle('open');
  logBtn.textContent = open ? 'Log ▼' : 'Log ▲';
});
drawerToggle.addEventListener('click', () => setDrawerOpen(drawer.classList.contains('closed')));
selectBox.addEventListener('change', () => loadDiagram(selectBox.value));

openFileBtn.addEventListener('click', () => openFileInput.click());
openFileInput.addEventListener('change', async () => {
  const file = openFileInput.files![0];
  if (!file)
    return;
  if (watcher)
    watcher.close();
  currentName = null;
  phoneFocusNodeId = null;
  phoneFocusUsesDecisionContext = false;
  currentDecisionId = null;
  codeBox.value = await file.text();
  restoreTypeMetadata(splitEditorMetadata(codeBox.value).metadata);
  resetEditorHistory(codeBox.value);
  selectBox.value = '';
  render();
  loadList();
  setDrawerOpen(true);
  openFileInput.value = '';
});

codeBox.addEventListener('input', () => {
  resetEditorHistory(codeBox.value);
  render();
});
// render();
// loadList();
loadDiagram('accountability.mmd');

Object.assign(window, { loadDiagram, codeBox, nodeIdOf, selectEditorNode, addQuestionAfter, addBlockAfter, removeQuestion, removeBlock, addChoice, removeChoice, removeChoices, undoEditorAction, redoEditorAction, insertStaticBefore, insertDecisionBefore });
