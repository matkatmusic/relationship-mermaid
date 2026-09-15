import { state } from './state.ts';
import { declarationSuffixOf, editorGraph, setEditorActionPromise } from './editor-graph.ts';
import { choiceId, nextEditorId, preserveInlineDecl, sourceWithLinesReplaced } from './source-edit.ts';
import { commitEditorSource } from './editor-actions.ts';
import type { EditorEdge } from './editor-types.ts';

export function addQuestionAfter() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = state.selectedEditorNodeId;
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

export function addBlockAfter() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = state.selectedEditorNodeId;
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

export function insertStaticBefore() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = state.selectedEditorNodeId;
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
  // Removing one segment drops the whole chained line, so recreate its other segments and their inline declarations.
  for (const edge of graph.edges) {
    if (!removedLineIndexes.has(edge.lineIndex) || edge.to === selected)
      continue;
    restoreInlineDecl(edge, edge.from);
    restoreInlineDecl(edge, edge.to);
    newLines.push(edge.label ? `  ${edge.from} -- "${edge.label}" --> ${edge.to}` : `  ${edge.from} --> ${edge.to}`);
  }
  setEditorActionPromise(commitEditorSource(sourceWithLinesReplaced(graph, removedLineIndexes, newLines)));
}

export function insertDecisionBefore() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const selected = state.selectedEditorNodeId;
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

export function choiceSuffixFromLabel(label: string) {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'CHOICE';
}

export function addChoice() {
  if (!state.selectedEditorNodeId)
    return;
  const graph = editorGraph();
  const questionId = state.selectedEditorNodeId;
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

