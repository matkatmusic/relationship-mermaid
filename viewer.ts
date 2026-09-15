import { codeBox } from './dom.ts';
import { nodeIdOf } from './render-helpers.ts';
import { selectEditorNode } from './editor-actions.ts';
import { addQuestionAfter, addBlockAfter, addChoice, insertStaticBefore, insertDecisionBefore } from './editor-add.ts';
import { removeQuestion, removeBlock, removeChoice, removeChoices, undoEditorAction, redoEditorAction } from './editor-remove.ts';
import { applyMainZoom } from './zoom.ts';
import { loadDiagram } from './diagram-io.ts';
import './editor-events.ts';
import './main-events.ts';

// render();
// loadList();
applyMainZoom(false);
loadDiagram('accountability.mmd');

Object.assign(window, { loadDiagram, codeBox, nodeIdOf, selectEditorNode, addQuestionAfter, addBlockAfter, removeQuestion, removeBlock, addChoice, removeChoice, removeChoices, undoEditorAction, redoEditorAction, insertStaticBefore, insertDecisionBefore });
