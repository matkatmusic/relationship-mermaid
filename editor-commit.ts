import type { EditorEdge, EditorGraph } from './editor-types.ts';
import { choiceId, nextEditorId, outgoingDestination, removeOutgoing, replaceOutgoing, sourceWithLinesReplaced } from './source-edit.ts';
import { commitEditorSource, enqueueEditorAction, selectEditorNode } from './editor-actions.ts';
import { NEW_DECISION_DESTINATION, NEW_STATIC_DESTINATION, state } from './state.ts';
import { focusInspectorDestination, focusInspectorText, replaceDeclarationInLine } from './node-inspector.ts';
import { declarationSuffixOf, editorGraph, setEditorActionPromise } from './editor-graph.ts';
import { destinationSelect, nodeTextInput } from './dom.ts';

export async function commitNewStaticAfter(sourceId: string, graph: EditorGraph) {
  const staticId = nextEditorId('B_NEW', graph);
  const source = `${replaceOutgoing(sourceId, staticId, graph)}\n  ${staticId}["New static block"]`;
  await commitEditorSource(source);
  state.focusDestinationAfterTextId = staticId;
  selectEditorNode(staticId);
  focusInspectorText();
}

export async function commitInsertStaticAfter(sourceId: string, graph: EditorGraph) {
  const staticId = nextEditorId('B_NEW', graph);
  const oldDestination = outgoingDestination(sourceId, graph);
  const newLines = [`  ${staticId}["New static block"]`];
  if (oldDestination)
    newLines.push(`  ${staticId} --> ${oldDestination}`);
  const source = `${replaceOutgoing(sourceId, staticId, graph)}\n${newLines.join('\n')}`;
  await commitEditorSource(source);
  state.focusDestinationAfterTextId = staticId;
  selectEditorNode(staticId);
  focusInspectorText();
}

export async function commitInsertDecisionAfter(sourceId: string, graph: EditorGraph) {
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
  // Replacing one edge segment removes the whole line; restore every other segment so only sourceId's tail changes.
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

export async function commitNewDecisionAfter(sourceId: string, graph: EditorGraph) {
  await commitInsertDecisionAfter(sourceId, graph);
}

export async function commitAddChoiceOnDecision(questionId: string, graph: EditorGraph) {
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

export function addChoiceOnDecision() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = state.selectedEditorNodeId;
  setEditorActionPromise(commitAddChoiceOnDecision(questionId, graph));
}

export function commitNodeText(id = state.selectedEditorNodeId, text = nodeTextInput.value.trim()) {
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

export function applyDestination(destination: string) {
  const id = state.selectedEditorNodeId;
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

export function commitDestination() {
  applyDestination(destinationSelect.value);
}

