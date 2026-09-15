import { state } from './state.ts';
import { editorGraph, setEditorActionPromise } from './editor-graph.ts';
import { preserveInlineDecl, sourceWithLinesReplaced } from './source-edit.ts';
import { commitEditorSource, runEditorAction, selectEditorNode, showRemovalPreview } from './editor-actions.ts';
import { nodeActions } from './dom.ts';

export function removeChoice() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const id = state.selectedEditorNodeId;
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

export function removeBlock() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const id = state.selectedEditorNodeId;
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

export function removeQuestion() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = state.selectedEditorNodeId;
  const choices: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from === questionId)
      choices.push(edge.to);
  }
  if (!choices.length)
    return;
  state.pendingRemoval = { questionId, choices, index: 0 };
  nodeActions.classList.add('removing');
  showRemovalPreview();
}

export function removeChoices() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = state.selectedEditorNodeId;
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

export function advanceRemovalPreview() {
  if (!state.pendingRemoval)
    return;
  state.pendingRemoval.index = (state.pendingRemoval.index + 1) % state.pendingRemoval.choices.length;
  showRemovalPreview();
}

export function cancelQuestionRemoval() {
  selectEditorNode(null);
}

export function confirmQuestionRemoval() {
  if (!state.pendingRemoval)
    return;
  const { questionId, choices, index } = state.pendingRemoval;
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

export function undoEditorAction() {
  if (state.editorHistoryIndex <= 0)
    return;
  state.editorHistoryIndex--;
  runEditorAction(() => commitEditorSource(state.editorHistory[state.editorHistoryIndex], { recordHistory: false }));
}

export function redoEditorAction() {
  if (state.editorHistoryIndex >= state.editorHistory.length - 1)
    return;
  state.editorHistoryIndex++;
  runEditorAction(() => commitEditorSource(state.editorHistory[state.editorHistoryIndex], { recordHistory: false }));
}

