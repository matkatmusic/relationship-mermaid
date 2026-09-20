declare const mermaid: any;
import { setEditorActionPromise, sourceWithEditorMetadata } from './editor-graph.ts';
import { codeBox, diagramBox, nodeActions, selectedNodeBox } from './dom.ts';
import { state } from './state.ts';
import { render } from './render.ts';
import { saveDiagram } from './diagram-io.ts';
import { renderNodeInspector } from './node-inspector.ts';

export async function commitEditorSource(source: string, options?: { recordHistory?: boolean }) {
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

export function enqueueEditorAction(action: () => Promise<void>) {
  // A rejected action must not permanently block every action queued after it.
  setEditorActionPromise(state.editorActionPromise.catch(() => {}).then(action));
}

export function runEditorAction(action: () => Promise<void>) {
  enqueueEditorAction(action);
}

export function selectEditorNode(id: string | null) {
  state.selectedEditorNodeId = id;
  if (state.advanceAfterDecisionText?.decisionId !== id)
    state.advanceAfterDecisionText = null;
  if (state.focusDestinationAfterTextId !== id)
    state.focusDestinationAfterTextId = null;
  state.pendingRemoval = null;
  nodeActions.classList.remove('removing');
  nodeActions.classList.toggle('open', !!id);
  selectedNodeBox.textContent = id ?? '';
  renderEditorSelection();
  renderNodeInspector();
}

export function renderEditorSelection() {
  for (const el of diagramBox.querySelectorAll('.editor-selected'))
    el.classList.remove('editor-selected');
  for (const el of diagramBox.querySelectorAll('.editor-preview'))
    el.classList.remove('editor-preview');
  if (state.selectedEditorNodeId) {
    const el = diagramBox.querySelector('[id*="flowchart-' + state.selectedEditorNodeId + '-"]');
    if (el)
      el.classList.add('editor-selected');
  }
  if (state.pendingRemoval) {
    const target = state.pendingRemoval.choices[state.pendingRemoval.index];
    const el = diagramBox.querySelector('[id*="flowchart-' + target + '-"]');
    if (el)
      el.classList.add('editor-preview');
  }
}

export function showRemovalPreview() {
  renderEditorSelection();
  renderNodeInspector();
}

