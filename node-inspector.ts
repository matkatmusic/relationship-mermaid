import { INSPECTOR_TITLES } from './editor-types.ts';
import type { EditorGraph, EditorNodeKind } from './editor-types.ts';
import { editorGraph } from './editor-graph.ts';
import { commitEditorSource, runEditorAction } from './editor-actions.ts';
import { destinationRow, destinationSelect, drawer, mainBox, nodeInspector, nodeInspectorActions, nodeInspectorControls, nodeInspectorDismissBtn, nodeInspectorRemovalPreview, nodeInspectorTitle, nodeTextInput, nodeTypeColorInput, nodeTypeColorRow, nodeTypeInput, nodeTypeRow } from './dom.ts';
import { NEW_DECISION_DESTINATION, NEW_STATIC_DESTINATION, state } from './state.ts';
import { colorForNode, effectiveNodeType } from './node-type-colors.ts';
import { outgoingDestination } from './source-edit.ts';

export function replaceDeclarationInLine(line: string, id: string, newToken: string) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escapedId}(\\{[^}]*\\}|\\[[^\\]]*\\]|\\(\\[[^\\]]*\\]\\))`);
  return line.replace(re, newToken);
}

// function beginInlineEdit(nodeEl: Element, id: string, kind: EditorNodeKind) {
//   const label = nodeEl.querySelector('.nodeLabel') as HTMLElement | null;
//   if (!label)
//     return;
//   label.contentEditable = 'true';
//   label.focus();
//   let committed = false;
//   const commit = () => {
//     if (committed)
//       return;
//     committed = true;
//     label.contentEditable = 'false';
//     const text = (label.textContent ?? '').trim();
//     const graph = editorGraph();
//     const node = graph.nodes.get(id);
//     if (!node)
//       return;
//     const newToken = kind === 'question' ? `${id}{"${text}"}` : `${id}["${text}"]`;
//     const lines = graph.lines.slice();
//     lines[node.lineIndex] = replaceDeclarationInLine(lines[node.lineIndex], id, newToken);
//     runEditorAction(() => commitEditorSource(lines.join('\n')));
//   };
//   label.addEventListener('keydown', (event) => {
//     if ((event as KeyboardEvent).key !== 'Enter')
//       return;
//     event.preventDefault();
//     commit();
//   });
//   label.addEventListener('blur', commit, { once: true });
// }

export function inspectorActionButton(action: string, label: string, spanTwoColumns = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.textContent = label;
  button.classList.toggle('span-2', spanTwoColumns);
  return button;
}

export function renderNodeInspector() {
  let graph: EditorGraph;
  try {
    graph = editorGraph();
  }
  catch {
    nodeInspector.hidden = true;
    return;
  }
  const node = graph.nodes.get(state.selectedEditorNodeId ?? '');
  nodeInspector.hidden = !node;
  if (!node)
    return;
  const previewing = !!state.pendingRemoval;
  nodeInspectorTitle.textContent = INSPECTOR_TITLES[node.kind];
  nodeTextInput.value = node.label;
  const nodeType = effectiveNodeType(node);
  nodeTypeRow.hidden = previewing || node.kind !== 'block';
  nodeTypeColorRow.hidden = previewing;
  nodeTypeInput.value = node.kind === 'block' ? nodeType : '';
  nodeTypeColorInput.value = colorForNode(node);
  nodeInspectorRemovalPreview.hidden = !previewing;
  nodeInspectorActions.hidden = previewing;
  nodeInspectorControls.hidden = previewing;
  if (previewing) {
    positionNodeInspector();
    return;
  }
  const actions: HTMLButtonElement[] = [inspectorActionButton('remove', 'Remove')];
  if (node.kind === 'question')
    actions.push(
      inspectorActionButton('add-choice', 'Add choice'),
      inspectorActionButton('remove-choices', 'Remove choices'),
      inspectorActionButton('insert-static-before', 'insert static block before'),
      inspectorActionButton('insert-decision-before', 'insert Decision & leading choice before'),
    );
  else if (node.kind === 'block')
    actions.push(
      inspectorActionButton('add-decision-after', 'add Decision block after'),
      inspectorActionButton('insert-decision-after', 'Insert decision block after'),
      inspectorActionButton('insert-static-after', 'Insert static block after'),
      inspectorActionButton('insert-static-before', 'insert static block before'),
      inspectorActionButton('insert-decision-before', 'insert Decision & leading choice before'),
    );
  else if (node.kind === 'choice')
    actions.push(
      inspectorActionButton('add-decision-after', 'add Decision block after'),
      inspectorActionButton('add-static-after', 'add static block after'),
      inspectorActionButton('insert-decision-after', 'Insert decision block after'),
      inspectorActionButton('insert-static-after', 'Insert static block after'),
    );
  nodeInspectorActions.replaceChildren(...actions);
  const hasDestination = node.kind !== 'question';
  destinationRow.hidden = !hasDestination;
  destinationSelect.replaceChildren();
  if (hasDestination) {
    destinationSelect.add(new Option('Terminal', ''));
    destinationSelect.add(new Option('New static block', NEW_STATIC_DESTINATION));
    destinationSelect.add(new Option('New Decision block', NEW_DECISION_DESTINATION));
    const destination = outgoingDestination(node.id, graph);
    for (const candidate of graph.nodes.values()) {
      const isSelf = candidate.id === node.id;
      const isHiddenChoice = candidate.kind === 'choice' && candidate.id !== destination;
      if (isSelf || isHiddenChoice)
        continue;
      destinationSelect.add(new Option(`${candidate.label} (${candidate.id})`, candidate.id));
    }
    destinationSelect.value = destination ?? '';
    nodeInspectorDismissBtn.textContent = destination ? 'Cancel' : 'Close';
  }
  else {
    nodeInspectorDismissBtn.textContent = 'Cancel';
  }
  positionNodeInspector();
}

export function positionNodeInspector() {
  if (nodeInspector.hidden)
    return;
  const drawerRect = drawer.getBoundingClientRect();
  const mainRect = mainBox.getBoundingClientRect();
  nodeInspector.style.width = '';
  nodeInspector.style.left = drawerRect.right + 'px';
  nodeInspector.style.top = mainRect.top + 'px';
}

export function focusInspectorText() {
  nodeTextInput.focus();
  nodeTextInput.select();
}

export function focusInspectorDestination() {
  destinationSelect.focus();
}

