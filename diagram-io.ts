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
  if (hasSavedLeft && hasSavedTop)
    return;
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

export function watchDiagram(name: string) {
  if (state.watcher)
    state.watcher.close();
  const source = new EventSource('/api/watch/' + encodeURIComponent(name));
  state.watcher = source;
  source.onmessage = async () => {
    const editSeqAtFetchStart = state.editSeq;
    const text = await fetch('/api/diagrams/' + encodeURIComponent(name)).then(r => r.text());
    const isStaleWatcher = state.watcher !== source;
    // A local edit landed while this fetch was in flight, so this response predates it;
    // applying it here would revert the just-committed edit before its own save reaches disk.
    const isStaleFetch = state.editSeq !== editSeqAtFetchStart;
    if (isStaleWatcher || isStaleFetch)
      return;
    const fetchedMetadata = splitEditorMetadata(text).metadata;
    if (typeof fetchedMetadata?.revision === 'number' && fetchedMetadata.revision < state.editSeq)
      return;
    if (text !== codeBox.value) {
      restoreTypeMetadata(fetchedMetadata);
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
  await fetch('/api/diagrams/' + encodeURIComponent(name), {
    method: 'PUT',
    body: codeBox.value,
  });
  state.currentName = name;
  setStatus('Saved ' + name);
  loadList();
  watchDiagram(name);
}

