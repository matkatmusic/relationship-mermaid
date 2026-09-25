import type { EditorGraph, EditorNode } from './editor-types.ts';
import { codeBox, diagramBox, nodeTypeColorInput, nodeTypeInput, phoneDiagramBox } from './dom.ts';
import { nodeIdOf } from './render-helpers.ts';
import { editorGraph, setEditorActionPromise, sourceWithEditorMetadata } from './editor-graph.ts';
import { saveDiagram } from './diagram-io.ts';
import { state } from './state.ts';

export function editorNodeKind(id: string, graph: EditorGraph) {
  return graph.nodes.get(id)?.kind;
}

export function effectiveNodeType(node: EditorNode) {
  if (node.kind === 'question')
    return 'decision';
  if (node.kind === 'choice')
    return 'choice';
  return state.nodeTypes[node.id]?.trim() || 'static';
}

export function colorForNode(node: EditorNode) {
  return state.typeColors[effectiveNodeType(node)] ?? state.typeColors.static;
}

export function applyNodeTypeColors(graph: EditorGraph) {
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

export async function saveTypeMetadata() {
  codeBox.value = sourceWithEditorMetadata(codeBox.value);
  await saveDiagram();
}

export function commitNodeType() {
  const id = state.selectedEditorNodeId;
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
    delete state.nodeTypes[id];
  else
    state.nodeTypes[id] = type;
  nodeTypeInput.value = type;
  applyNodeTypeColors(graph);
  setEditorActionPromise(saveTypeMetadata());
}

export function commitTypeColor() {
  const id = state.selectedEditorNodeId;
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
  state.typeColors[effectiveNodeType(node)] = nodeTypeColorInput.value;
  applyNodeTypeColors(graph);
  setEditorActionPromise(saveTypeMetadata());
}

