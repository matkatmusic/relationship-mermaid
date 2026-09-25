import { codeBox, diagramBox, drawer, outputBox, selectBox, statusBox } from './dom.ts';
import { positionNodeInspector } from './node-inspector.ts';
import { phonePath, state } from './state.ts';
import { selectEditorNode } from './editor-actions.ts';
import type { EditorGraph, EditorMetadata, EditorNode } from './editor-types.ts';
import { editorGraph, restoreTypeMetadata, splitEditorMetadata } from './editor-graph.ts';
import { render } from './render.ts';
import { applyMainZoom } from './zoom.ts';

export function setStatus(text: string) {
  statusBox.textContent = text;
  setTimeout(() => {
    if (statusBox.textContent === text)
      statusBox.textContent = '';
  }, 2000);
}

export function setDrawerOpen(open: boolean) {
  drawer.classList.toggle('closed', !open);
  positionNodeInspector();
}

export async function loadList() {
  const names = await fetch('/api/diagrams').then(r => r.json());
  selectBox.innerHTML = '<option value="" disabled ' + (state.currentName ? '' : 'selected') + '>Diagrams</option>';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    if (name === state.currentName)
      option.selected = true;
    selectBox.appendChild(option);
  }
}

export function resetEditorHistory(text: string) {
  state.editorHistory = [text];
  state.editorHistoryIndex = 0;
  selectEditorNode(null);
}

export function restoreMainViewport(metadata: EditorMetadata | null, graph: EditorGraph) {
  const hasSavedLeft = typeof metadata?.outputScrollLeft === 'number';
  const hasSavedTop = typeof metadata?.outputScrollTop === 'number';
  if (hasSavedLeft)
    outputBox.scrollLeft = metadata.outputScrollLeft!;
  if (hasSavedTop)
    outputBox.scrollTop = metadata.outputScrollTop!;
  if (hasSavedLeft) {
    if (hasSavedTop)
      return;
  }
  const firstNode = graph.nodes.values().next().value as EditorNode | undefined;
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

export async function loadDiagram(name: string) {
  const text = await fetch('/api/diagrams/' + encodeURIComponent(name)).then(r => r.text());
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
  let graph: EditorGraph | null = null;
  try {
    graph = editorGraph();
  }
  catch {
    // render() has already surfaced the validation failure.
  }
  if (metadata) {
    if (graph?.nodes.has(metadata.lastSelectedNodeId ?? ''))
      selectEditorNode(metadata.lastSelectedNodeId);
  }
  if (graph)
    restoreMainViewport(metadata, graph);
  loadList();
  watchDiagram(name);
}

let lastSavedDiagramText: string | null = null;
let watchedDiagramName: string | null = null;
let pendingSaveCount = 0;
let saveVersion = 0;

export function watchDiagram(name: string) {
  if (state.watcher)
    state.watcher.close();
  watchedDiagramName = name;
  const source = new EventSource('/api/watch/' + encodeURIComponent(name));
  state.watcher = source;
  source.onmessage = async () => {
    const versionAtFetchStart = saveVersion;
    const saveInFlightAtFetchStart = pendingSaveCount > 0;
    const text = await fetch('/api/diagrams/' + encodeURIComponent(name)).then(r => r.text());
    const isStaleWatcher = state.watcher !== source;
    if (isStaleWatcher)
      return;
    // The server may answer this GET from the file before that save's PUT lands, returning pre-edit text.
    if (saveInFlightAtFetchStart)
      return;
    // A save (ours or one still in flight when this fetch started, or one that started and finished
    // while this fetch was in flight) triggered this notification; not an external edit to react to.
    if (pendingSaveCount > 0 || saveVersion !== versionAtFetchStart)
      return;
    if (text === lastSavedDiagramText)
      return;
    if (text !== codeBox.value) {
      restoreTypeMetadata(splitEditorMetadata(text).metadata);
      codeBox.value = text;
      resetEditorHistory(text);
    }
    render();
  };
}

export async function saveDiagram() {
  let name = state.currentName;
  if (!name) {
    name = prompt('Name this diagram (letters, numbers, - and _ only):');
    if (!name)
      return;
    if (!name.endsWith('.mmd'))
      name += '.mmd';
  }
  lastSavedDiagramText = codeBox.value;
  pendingSaveCount++;
  saveVersion++;
  try {
    await fetch('/api/diagrams/' + encodeURIComponent(name), {
      method: 'PUT',
      body: codeBox.value,
    });
  }
  finally {
    pendingSaveCount--;
  }
  state.currentName = name;
  setStatus('Saved ' + name);
  loadList();
  // Don't reopen the watcher here: it's already watching this file from loadDiagram,
  // and reopening on every save raced a still-in-flight old watcher's onmessage against the new one.
  const hasNoWatcher = !state.watcher;
  if (hasNoWatcher) {
    watchDiagram(name);
  }
  else {
    const isWatchingSomethingElse = watchedDiagramName !== name;
    if (isWatchingSomethingElse)
      watchDiagram(name);
  }
}

