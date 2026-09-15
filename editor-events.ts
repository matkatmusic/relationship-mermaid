import { codeBox, destinationSelect, nodeInspectorActions, nodeInspectorDismissBtn, nodeTextInput, nodeTypeColorInput, nodeTypeInput, outputBox, phoneDiagramBox } from './dom.ts';
import { isAnswerId, nodeIdOf } from './render-helpers.ts';
import { selectEditorNode } from './editor-actions.ts';
import { editorGraph, setEditorActionPromise } from './editor-graph.ts';
import { NEW_DECISION_DESTINATION, NEW_STATIC_DESTINATION, phonePath, state } from './state.ts';
import { render } from './render.ts';
import { nearestFeedingChoice } from './decision-nav.ts';
import { parseEdges } from './diagram-source.ts';
import { choicesOf } from './graph-slice.ts';
import { addBlockAfter, addChoice, addQuestionAfter, insertDecisionBefore, insertStaticBefore } from './editor-add.ts';
import { advanceRemovalPreview, cancelQuestionRemoval, confirmQuestionRemoval, redoEditorAction, removeBlock, removeChoice, removeChoices, removeQuestion, undoEditorAction } from './editor-remove.ts';
import { addChoiceOnDecision, applyDestination, commitDestination, commitInsertDecisionAfter, commitInsertStaticAfter, commitNodeText } from './editor-commit.ts';
import { commitNodeType, commitTypeColor } from './node-type-colors.ts';
import { positionNodeInspector } from './node-inspector.ts';

outputBox.addEventListener('click', (event) => {
  const nodeEl = (event.target as HTMLElement).closest('g.node');
  const id = nodeEl ? nodeIdOf(nodeEl) : null;
  selectEditorNode(id);
  if (id) {
    const graph = editorGraph();
    const node = graph.nodes.get(id);
    if (node?.kind === 'question') {
      state.phoneFocusNodeId = id;
      state.phoneFocusUsesDecisionContext = true;
      state.phonePreviewChoiceId = null;
      render();
    }
    else {
      const feedingChoice = nearestFeedingChoice(id, graph);
      if (feedingChoice) {
        state.phoneFocusNodeId = null;
        state.phoneFocusUsesDecisionContext = false;
        state.phonePreviewChoiceId = feedingChoice;
        render();
      }
    }
  }
});

phoneDiagramBox.addEventListener('click', (event) => {
  const nodeEl = (event.target as HTMLElement).closest('g.node');
  if (!nodeEl)
    return;
  const clicked = nodeIdOf(nodeEl);
  const edges = parseEdges(codeBox.value);
  if (!isAnswerId(clicked, edges))
    return;
  const openChoices = state.currentBottomQ ? choicesOf(state.currentBottomQ, edges) : [];
  if (!openChoices.includes(clicked))
    return;
  phonePath.push(clicked);
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  render();
});

outputBox.addEventListener('dblclick', (event) => {
  const nodeEl = (event.target as HTMLElement).closest('g.node');
  if (!nodeEl)
    return;
  selectEditorNode(nodeIdOf(nodeEl));
  nodeTextInput.focus();
  nodeTextInput.select();
});

document.getElementById('addQuestionAfterBtn')!.addEventListener('click', addQuestionAfter);
document.getElementById('addBlockAfterBtn')!.addEventListener('click', addBlockAfter);
document.getElementById('removeQuestionBtn')!.addEventListener('click', removeQuestion);
document.getElementById('removeBlockBtn')!.addEventListener('click', removeBlock);
document.getElementById('addChoiceBtn')!.addEventListener('click', addChoice);
document.getElementById('removeChoiceBtn')!.addEventListener('click', removeChoice);
document.getElementById('nextRemovalPathBtn')!.addEventListener('click', advanceRemovalPreview);
document.getElementById('confirmRemoveQuestionBtn')!.addEventListener('click', confirmQuestionRemoval);
document.getElementById('cancelRemoveQuestionBtn')!.addEventListener('click', cancelQuestionRemoval);
document.getElementById('editorUndoBtn')!.addEventListener('click', undoEditorAction);
document.getElementById('editorRedoBtn')!.addEventListener('click', redoEditorAction);
document.getElementById('nodeInspectorDismissBtn')!.addEventListener('click', () => selectEditorNode(null));
destinationSelect.addEventListener('change', commitDestination);
nodeInspectorActions.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  const action = button?.dataset.action;
  if (action === 'add-static-after')
    applyDestination(NEW_STATIC_DESTINATION);
  else if (action === 'insert-static-after') {
    if (!state.selectedEditorNodeId)
      return;
    setEditorActionPromise(commitInsertStaticAfter(state.selectedEditorNodeId, editorGraph()));
  }
  else if (action === 'insert-decision-after') {
    if (!state.selectedEditorNodeId)
      return;
    setEditorActionPromise(commitInsertDecisionAfter(state.selectedEditorNodeId, editorGraph()));
  }
  else if (action === 'add-decision-after')
    applyDestination(NEW_DECISION_DESTINATION);
  else if (action === 'add-choice')
    addChoiceOnDecision();
  else if (action === 'remove') {
    const kind = editorGraph().nodes.get(state.selectedEditorNodeId ?? '')?.kind;
    if (kind === 'question')
      removeQuestion();
    else if (kind === 'block')
      removeBlock();
    else if (kind === 'choice')
      removeChoice();
  }
  else if (action === 'remove-choices')
    removeChoices();
  else if (action === 'insert-static-before')
    insertStaticBefore();
  else if (action === 'insert-decision-before')
    insertDecisionBefore();
});
nodeTextInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter')
    return;
  event.preventDefault();
  commitNodeText();
});
nodeTypeInput.addEventListener('change', commitNodeType);
nodeTypeColorInput.addEventListener('change', commitTypeColor);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape')
    return;
  selectEditorNode(null);
});
outputBox.addEventListener('scroll', positionNodeInspector);
window.addEventListener('resize', positionNodeInspector);
