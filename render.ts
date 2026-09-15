declare const mermaid: any;
import { codeBox, decisionCounter, diagramBox, errorBox, errorLog, outputBox, phoneDiagramBox } from './dom.ts';
import { editorGraph } from './editor-graph.ts';
import { discardInvalidPhonePreview, updateDecisionCounter } from './decision-nav.ts';
import { chunkSource, parseEdges } from './diagram-source.ts';
import { choicesOf, leadInIds, renderLog, siblingIds, sliceIds } from './graph-slice.ts';
import { phonePath, state } from './state.ts';
import { applyNodeTypeColors } from './node-type-colors.ts';
import { renderEditorSelection } from './editor-actions.ts';
import { highlightPath, showEditorValidationError } from './render-helpers.ts';
import { baseScale, viewBoxOf } from './zoom.ts';
import { drawLastDecisionMask, drawSeparatorBetween, scrollChoicesIntoView } from './phone-separators.ts';
import { positionNodeInspector } from './node-inspector.ts';

export async function render() {
  errorBox.textContent = '';
  try {
    // Validate before Mermaid sees the source. Invalid diagrams remain visible
    // only as their actionable editor error and cannot be edited or rendered.
    const graph = editorGraph();
    discardInvalidPhonePreview(graph);
    updateDecisionCounter(graph);
    const edges = parseEdges(codeBox.value);
    const ids = edges.length > 0 ? sliceIds(edges) : [];
    const siblings = siblingIds(ids, edges);
    const leadIns = leadInIds(ids, siblings, edges);
    const shown = new Set([...ids, ...siblings, ...leadIns]);
    const reversedIds = [...ids].reverse();
    let bottomQ = state.phoneFocusNodeId && graph.nodes.get(state.phoneFocusNodeId)?.kind === 'question'
      ? state.phoneFocusNodeId
      : undefined;
    if (!bottomQ) {
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
    }
    state.currentBottomQ = bottomQ;
    const phoneSource = edges.length > 0 ? chunkSource(shown, siblings, edges) : codeBox.value;
    const regularViewport = { left: outputBox.scrollLeft, top: outputBox.scrollTop };
    const phoneViewport = { left: phoneDiagramBox.scrollLeft, top: phoneDiagramBox.scrollTop };
    const [{ svg: regularSvg }, { svg: phoneSvg }] = await Promise.all([
      mermaid.render('diagram-' + (state.renderId++), codeBox.value),
      mermaid.render('phone-diagram-' + (state.renderId++), phoneSource),
    ]);
    diagramBox.innerHTML = regularSvg;
    phoneDiagramBox.innerHTML = phoneSvg;
    applyNodeTypeColors(graph);
    renderEditorSelection();
    highlightPath();
    if (edges.length > 0) {
      if (state.diagramScale === null)
        state.diagramScale = await baseScale(edges);
      const scale = state.diagramScale;
      const mainZoom = state.mainZoomPercent / 100;
      const regularSvgEl = diagramBox.querySelector('svg')!;
      const regularBox = viewBoxOf(regularSvg);
      regularSvgEl.style.width = regularBox.width * scale * mainZoom + 'px';
      regularSvgEl.style.height = regularBox.height * scale * mainZoom + 'px';
      const phoneSvgEl = phoneDiagramBox.querySelector('svg')!;
      const phoneBox = viewBoxOf(phoneSvg);
      const phoneWidth = Math.max(phoneBox.width * scale, phoneDiagramBox.clientWidth);
      phoneSvgEl.style.width = phoneWidth + 'px';
      phoneSvgEl.style.height = phoneBox.height * scale + 'px';
    }
    outputBox.scrollLeft = regularViewport.left;
    outputBox.scrollTop = regularViewport.top;
    phoneDiagramBox.scrollLeft = phoneViewport.left;
    phoneDiagramBox.scrollTop = phoneViewport.top;
    renderLog(edges);
    const hasContextualPreviousDecision = state.phoneFocusUsesDecisionContext
      && ids[0] !== state.phoneFocusNodeId
      && graph.nodes.get(ids[0])?.kind === 'question';
    const shouldDrawLastDecision = edges.length > 0 && (phonePath.length > 0 || state.phonePreviewChoiceId || hasContextualPreviousDecision);
    if (shouldDrawLastDecision)
      drawLastDecisionMask(ids, edges, bottomQ);
    if (shouldDrawLastDecision)
      drawSeparatorBetween(ids[0], choicesOf(ids[0], edges), 'last decision');
    const shouldDrawBottomSeparator = edges.length > 0 && bottomQ;
    if (shouldDrawBottomSeparator)
      drawSeparatorBetween(bottomQ!, choicesOf(bottomQ!, edges), 'open decision');
    if (edges.length > 0)
      scrollChoicesIntoView(bottomQ, edges);
    positionNodeInspector();
    errorLog.textContent = '';
    errorLog.classList.remove('open');
  }
  catch (err) {
    state.currentDecisionId = null;
    decisionCounter.textContent = '0 / 0';
    showEditorValidationError(err);
  }
}

