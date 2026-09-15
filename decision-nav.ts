import type { EditorGraph } from './editor-types.ts';
import { editorGraph } from './editor-graph.ts';
import { state } from './state.ts';
import { decisionCounter, diagramBox, outputBox } from './dom.ts';
import { showEditorValidationError } from './render-helpers.ts';
import { setStatus } from './diagram-io.ts';
import { selectEditorNode } from './editor-actions.ts';
import { render } from './render.ts';

export function decisionNodes(graph: EditorGraph) {
  // editorGraph only exposes validated, standalone declarations. A question is therefore exactly a standalone brace-shaped decision for navigation.
  return [...graph.nodes.values()]
    .filter(node => node.kind === 'question')
    .sort((a, b) => a.lineIndex - b.lineIndex);
}

export function nearestDecisionFrom(id: string, step: 1 | -1, graph: EditorGraph) {
  const visited = new Set([id]);
  let frontier = [id];
  while (frontier.length) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of graph.edges) {
        const neighbor = step === 1
          ? edge.from === nodeId ? edge.to : null
          : edge.to === nodeId ? edge.from : null;
        if (!neighbor || visited.has(neighbor))
          continue;
        visited.add(neighbor);
        if (graph.nodes.get(neighbor)?.kind === 'question')
          return graph.nodes.get(neighbor);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }
}

export function nearestFeedingChoice(id: string, graph: EditorGraph) {
  const visited = new Set([id]);
  let frontier = [id];
  while (frontier.length) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      const node = graph.nodes.get(nodeId);
      const isChoiceFedByDecision = node?.kind === 'choice'
        && graph.edges.some(edge => edge.to === nodeId && graph.nodes.get(edge.from)?.kind === 'question');
      if (isChoiceFedByDecision)
        return nodeId;
      for (const edge of graph.edges) {
        if (edge.to !== nodeId || visited.has(edge.from))
          continue;
        visited.add(edge.from);
        nextFrontier.push(edge.from);
      }
    }
    frontier = nextFrontier;
  }
  return null;
}

export function discardInvalidPhonePreview(graph: EditorGraph) {
  if (state.phoneFocusNodeId && graph.nodes.get(state.phoneFocusNodeId)?.kind !== 'question') {
    state.phoneFocusNodeId = null;
    state.phoneFocusUsesDecisionContext = false;
  }
  if (state.phonePreviewChoiceId && nearestFeedingChoice(state.phonePreviewChoiceId, graph) !== state.phonePreviewChoiceId)
    state.phonePreviewChoiceId = null;
}

export function updateDecisionCounter(graph: EditorGraph) {
  const decisions = decisionNodes(graph);
  if (decisions.length === 0) {
    state.currentDecisionId = null;
    decisionCounter.textContent = '0 / 0';
    return decisions;
  }
  if (!decisions.some(node => node.id === state.currentDecisionId)) {
    const selectedDecision = decisions.find(node => node.id === state.selectedEditorNodeId);
    state.currentDecisionId = selectedDecision?.id ?? decisions[0].id;
  }
  const current = decisions.findIndex(node => node.id === state.currentDecisionId) + 1;
  decisionCounter.textContent = `${current} / ${decisions.length}`;
  return decisions;
}

export function centerNodeInViewport(container: HTMLElement, diagram: Element, id: string) {
  const node = diagram.querySelector('[id*="flowchart-' + id + '-"]');
  if (!node)
    return;
  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  container.scrollLeft += nodeRect.left + nodeRect.width / 2 - containerRect.left - container.clientWidth / 2;
  container.scrollTop += nodeRect.top + nodeRect.height / 2 - containerRect.top - container.clientHeight / 2;
}

export async function navigateDecision(step: 1 | -1) {
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
  const selected = graph.nodes.get(state.selectedEditorNodeId ?? '');
  const nearest = selected ? nearestDecisionFrom(selected.id, step, graph) : undefined;
  const anchorId = selected?.kind === 'question' ? selected.id : state.currentDecisionId;
  const currentIndex = decisions.findIndex(node => node.id === anchorId);
  const nextIndex = (currentIndex + step + decisions.length) % decisions.length;
  const decision = nearest ?? decisions[nextIndex];
  state.currentDecisionId = decision.id;
  state.phoneFocusNodeId = decision.id;
  state.phoneFocusUsesDecisionContext = true;
  state.phonePreviewChoiceId = null;
  selectEditorNode(decision.id);
  updateDecisionCounter(graph);
  await render();
  centerNodeInViewport(outputBox, diagramBox, decision.id);
}

