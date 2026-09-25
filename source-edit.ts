import type { EditorEdge, EditorGraph } from './editor-types.ts';
import { declarationSuffixOf } from './editor-graph.ts';

export function sourceWithLinesReplaced(graph: EditorGraph, removedLineIndexes: Set<number>, newLines: string[]) {
  const kept = graph.lines.filter((_, lineIndex) => !removedLineIndexes.has(lineIndex));
  return [...kept, ...newLines].join('\n');
}

export function nextEditorId(prefix: string, graph: EditorGraph) {
  let n = 1;
  while (graph.nodes.has(`${prefix}_${n}`))
    n++;
  return `${prefix}_${n}`;
}

export function choiceId(questionId: string, suffix: string) {
  return `Q_CHOICE_${questionId.replace(/^Q_/, '')}_${suffix}`;
}

export function outgoingDestination(id: string, graph: EditorGraph) {
  return graph.edges.find(edge => edge.from === id)?.to;
}

export function sourceWithOutgoingChanged(id: string, destination: string | undefined, graph: EditorGraph) {
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

export function replaceOutgoing(id: string, destination: string, graph: EditorGraph) {
  return sourceWithOutgoingChanged(id, destination, graph);
}

export function removeOutgoing(id: string, graph: EditorGraph) {
  return sourceWithOutgoingChanged(id, undefined, graph);
}

export function preserveInlineDecl(edge: EditorEdge, keepEndpointId: string, graph: EditorGraph, newLines: string[]) {
  const node = graph.nodes.get(keepEndpointId);
  if (node && node.lineIndex === edge.lineIndex)
    newLines.push(`  ${keepEndpointId}${declarationSuffixOf(node)}`);
}

