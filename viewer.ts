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
const outputBox = document.getElementById('output')!;
const phoneToggle = document.getElementById('phoneToggle') as HTMLInputElement;
const logBtn = document.getElementById('logBtn')!;
const logBox = document.getElementById('logBox')!;
let renderId = 0;
let currentName: string | null = null;
let watcher: EventSource | null = null;
let currentBottomQ: string | undefined;
const chosenAnswers = new Set();
const phonePath: string[] = []; // decision node ids clicked in phone view, in order
const MAX_PHONE_NODES = 8;
const PHONE_INNER = { width: 327, height: 514 };
const nodeActions = document.getElementById('nodeActions')!;
const selectedNodeBox = document.getElementById('selectedNode')!;
let selectedEditorNodeId: string | null = null;
const nodeInspector = document.getElementById('nodeInspector')!;
const nodeInspectorTitle = document.getElementById('nodeInspectorTitle')!;
const nodeTextInput = document.getElementById('nodeTextInput') as HTMLInputElement;
const nodeInspectorDismissBtn = document.getElementById('nodeInspectorDismissBtn')!;
const destinationRow = document.getElementById('destinationRow')!;
const destinationSelect = document.getElementById('destinationSelect') as HTMLSelectElement;
const nodeInspectorActions = document.getElementById('nodeInspectorActions')!;
const NEW_STATIC_DESTINATION = 'new-static';
const NEW_DECISION_DESTINATION = 'new-decision';
let advanceAfterDecisionText: { decisionId: string; choiceId: string } | null = null;
let focusDestinationAfterTextId: string | null = null;
let pendingRemoval: PendingRemoval | null = null;
let editorHistory: string[] = [codeBox.value];
let editorHistoryIndex = 0;
let editorActionPromise: Promise<void>;

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
  // return Math.min(PHONE_INNER.width / box.width, diagramBox.clientHeight / box.height);
  const wasPhone = outputBox.classList.contains('phone');
  outputBox.classList.add('phone');
  const screenWidth = diagramBox.clientWidth;
  const screenHeight = diagramBox.clientHeight;
  outputBox.classList.toggle('phone', wasPhone);
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

function sliceIds(edges: Edge[]) {
  const last = phonePath[phonePath.length - 1];
  const ids = last ? [parentOf(last, edges), last] : [edges[0][0]];
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
  if (!phonePath.length)
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
    const idIsAnswerOfFrom = id.startsWith(from + '_');
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

interface PendingRemoval {
  questionId: string;
  choices: string[];
  index: number;
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

function parseEditorEdgeLine(line: string) {
  const labelled = line.match(/^(.+?)\s--\s(?:"([^"]*)"|(\S.*?))\s-->\s(.+)$/);
  if (labelled)
    return { fromToken: labelled[1], label: labelled[2] ?? labelled[3], toToken: labelled[4] };
  const plain = line.match(/^(.+?)\s-->\s(.+)$/);
  if (plain)
    return { fromToken: plain[1], label: undefined as string | undefined, toToken: plain[2] };
  return null;
}

function declarationSuffixOf(node: EditorNode) {
  return node.kind === 'question' ? `{"${node.label}"}` : `["${node.label}"]`;
}

function editorGraph(): EditorGraph {
  const lines = codeBox.value.split('\n');
  const declLines = new Map<string, { shape: 'brace' | 'rect' | 'other'; label: string; lineIndex: number }>();
  const edges: EditorEdge[] = [];
  const recordDecl = (token: ReturnType<typeof parseEditorToken>, lineIndex: number) => {
    if (token.shape && !declLines.has(token.id))
      declLines.set(token.id, { shape: token.shape, label: token.label, lineIndex });
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    const isSkippable = !line || line.startsWith('flowchart') || line.startsWith('classDef') || line.startsWith('class ') || line.startsWith('%%');
    if (isSkippable)
      continue;
    const edge = parseEditorEdgeLine(line);
    if (edge) {
      const from = parseEditorToken(edge.fromToken);
      const to = parseEditorToken(edge.toToken);
      recordDecl(from, lineIndex);
      recordDecl(to, lineIndex);
      edges.push({ from: from.id, to: to.id, label: edge.label, lineIndex });
    }
    else {
      const decl = parseEditorToken(line);
      recordDecl(decl, lineIndex);
    }
  }
  const nodes = new Map<string, EditorNode>();
  for (const [id, decl] of declLines) {
    const kind: EditorNodeKind = decl.shape === 'brace'
      ? 'question'
      : edges.some(e => e.to === id && !e.label && id.startsWith(e.from + '_'))
        ? 'choice'
        : 'block';
    nodes.set(id, { id, kind, label: decl.label, lineIndex: decl.lineIndex });
  }
  return { lines, nodes, edges };
}

function editorNodeKind(id: string, graph: EditorGraph) {
  return graph.nodes.get(id)?.kind;
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
  return `${questionId}_${suffix}`;
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
  const graph = editorGraph();
  const node = graph.nodes.get(selectedEditorNodeId ?? '');
  nodeInspector.hidden = !node;
  if (!node)
    return;
  nodeInspectorTitle.textContent = INSPECTOR_TITLES[node.kind];
  nodeTextInput.value = node.label;
  const actions: HTMLButtonElement[] = [];
  if (node.kind === 'block')
    actions.push(inspectorActionButton('add-decision-after', 'add Decision block after', true));
  else if (node.kind === 'choice')
    actions.push(
      inspectorActionButton('add-decision-after', 'add Decision block after'),
      inspectorActionButton('add-static-after', 'add static block after'),
    );
  nodeInspectorActions.replaceChildren(...actions);
  const hasDestination = node.kind !== 'question';
  destinationRow.hidden = !hasDestination;
  destinationSelect.replaceChildren();
  if (hasDestination) {
    destinationSelect.add(new Option('Terminal', ''));
    destinationSelect.add(new Option('New static block', NEW_STATIC_DESTINATION));
    destinationSelect.add(new Option('New Decision block', NEW_DECISION_DESTINATION));
    for (const candidate of graph.nodes.values()) {
      if (candidate.id === node.id || candidate.kind === 'choice')
        continue;
      destinationSelect.add(new Option(`${candidate.label} (${candidate.id})`, candidate.id));
    }
    const destination = outgoingDestination(node.id, graph);
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
  const nodeEl = diagramBox.querySelector('[id*="flowchart-' + selectedEditorNodeId + '-"]');
  if (!nodeEl)
    return;
  const node = nodeEl.getBoundingClientRect();
  const output = outputBox.getBoundingClientRect();
  const gap = 12;
  const maxWidth = 320;
  const spaceRight = output.right - node.right - gap;
  const spaceLeft = node.left - output.left - gap;
  const fitsRight = spaceRight >= maxWidth;
  nodeInspector.style.width = Math.max(0, Math.min(maxWidth, Math.max(spaceRight, spaceLeft))) + 'px';
  const card = nodeInspector.getBoundingClientRect();
  const preferredLeft = fitsRight || spaceRight >= spaceLeft ? node.right + gap : node.left - gap - card.width;
  nodeInspector.style.left = Math.max(output.left, Math.min(preferredLeft, output.right - card.width)) + 'px';
  nodeInspector.style.top = Math.max(output.top, Math.min(node.top, output.bottom - card.height)) + 'px';
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

async function commitNewDecisionAfter(sourceId: string, graph: EditorGraph) {
  const decisionId = nextEditorId('Q_NEW', graph);
  const newChoiceId = choiceId(decisionId, 'NEW');
  const source = `${replaceOutgoing(sourceId, decisionId, graph)}\n  ${decisionId}{"New Decision"}\n  ${newChoiceId}["New choice"]\n  ${decisionId} --> ${newChoiceId}`;
  await commitEditorSource(source);
  advanceAfterDecisionText = { decisionId, choiceId: newChoiceId };
  selectEditorNode(decisionId);
  focusInspectorText();
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

outputBox.addEventListener('dblclick', (event) => {
  if (phoneToggle.checked)
    return;
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
  else if (action === 'add-decision-after')
    applyDestination(NEW_DECISION_DESTINATION);
});
nodeTextInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter')
    return;
  event.preventDefault();
  commitNodeText();
});
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
  const svg = diagramBox.querySelector('svg')!;
  const nodeEl = (id: string) => diagramBox.querySelector('[id*="flowchart-' + id + '-"]') as SVGGraphicsElement | null;
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
  const svg = diagramBox.querySelector('svg')!;
  const nodeEl = (id: string) => diagramBox.querySelector('[id*="flowchart-' + id + '-"]') as SVGGraphicsElement | null;
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
  const svg = diagramBox.querySelector('svg')!;
  const nodeEl = (id: string) => diagramBox.querySelector('[id*="flowchart-' + id + '-"]') as SVGGraphicsElement | null;
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
  const atStart = phonePath.length === 0;
  if (atStart) {
    diagramBox.scrollTop = 0;
    return;
  }
  if (!bottomQ)
    return;
  let lastChoice: Element | null = null;
  for (const [from, to] of edges) {
    const isChoice = from === bottomQ;
    if (isChoice)
      lastChoice = diagramBox.querySelector('[id*="flowchart-' + to + '-"]');
  }
  if (!lastChoice)
    return;
  lastChoice.scrollIntoView({ block: 'end' });
}

async function render() {
  const id = 'diagram-' + (renderId++);
  errorBox.textContent = '';
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
    const viewport = { left: outputBox.scrollLeft, top: outputBox.scrollTop };
    diagramBox.innerHTML = svg;
    renderEditorSelection();
    if (edges.length > 0) {
      const scale = await baseScale(edges);
      const svgEl = diagramBox.querySelector('svg')!;
      const box = viewBoxOf(svg);
      // svgEl.style.width = box.width * scale + 'px';
      // const phoneWidth = phone ? Math.max(box.width * scale, PHONE_INNER.width) : box.width * scale;
      const phoneWidth = phone ? Math.max(box.width * scale, diagramBox.clientWidth) : box.width * scale;
      svgEl.style.width = phoneWidth + 'px';
      svgEl.style.height = box.height * scale + 'px';
    }
    outputBox.scrollLeft = viewport.left;
    outputBox.scrollTop = viewport.top;
    if (phone)
      renderLog(edges);
      // if (phone)
      //   drawSeparator(ids, leadIns);
    const shouldDrawLastDecision = phone && phonePath.length > 0;
    if (shouldDrawLastDecision)
      drawLastDecisionMask(ids, edges);
    if (shouldDrawLastDecision)
      drawSeparatorBetween(ids[0], choicesOf(ids[0], edges), 'last decision');
    const shouldDrawBottomSeparator = phone && bottomQ;
    if (shouldDrawBottomSeparator)
      drawSeparatorBetween(bottomQ!, choicesOf(bottomQ!, edges), 'open decision');
    if (phone)
      scrollChoicesIntoView(bottomQ, edges);
    if (!phone)
      highlightPath();
      // updateSvgSizingForPhoneMode();
    positionNodeInspector();
    errorLog.textContent = '';
    errorLog.classList.remove('open');
  }
  catch (err) {
    errorBox.textContent = (err as Error).message;
    errorLog.textContent += (err as Error).message + '\n';
    errorLog.classList.add('open');
    errorLog.scrollTop = errorLog.scrollHeight;
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
  currentName = name;
  codeBox.value = text;
  resetEditorHistory(text);
  render();
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
  codeBox.value = 'flowchart TD\n  A[New idea]';
  resetEditorHistory(codeBox.value);
  render();
  loadList();
  setDrawerOpen(true);
});
document.getElementById('saveBtn')!.addEventListener('click', saveDiagram);
document.getElementById('resetBtn')!.addEventListener('click', () => {
  chosenAnswers.clear();
  phonePath.length = 0;
  highlightPath();
  render();
  outputBox.scrollTo({ top: 0, behavior: 'smooth' });
});
document.getElementById('undoBtn')!.addEventListener('click', (event) => {
  event.stopPropagation();
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
phoneToggle.addEventListener('change', () => {
  if (phoneToggle.checked)
    selectEditorNode(null);
  outputBox.classList.toggle('phone', phoneToggle.checked);
  render();
});

openFileBtn.addEventListener('click', () => openFileInput.click());
openFileInput.addEventListener('change', async () => {
  const file = openFileInput.files![0];
  if (!file)
    return;
  if (watcher)
    watcher.close();
  currentName = null;
  codeBox.value = await file.text();
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

Object.assign(window, { loadDiagram, codeBox, nodeIdOf, selectEditorNode, addQuestionAfter, addBlockAfter, removeQuestion, removeBlock, addChoice, removeChoice, undoEditorAction, redoEditorAction });
