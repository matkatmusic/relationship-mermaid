import { MAIN_ZOOM_STEP, chosenAnswers, phonePath, state } from './state.ts';
import { restoreTypeMetadata, splitEditorMetadata } from './editor-graph.ts';
import { codeBox, drawer, drawerToggle, logBox, logBtn, nextDecisionBtn, openFileBtn, openFileInput, outputBox, phoneDiagramBox, previousDecisionBtn, selectBox, zoomInBtn, zoomOutBtn, zoomResetBtn } from './dom.ts';
import { loadDiagram, loadList, resetEditorHistory, saveDiagram, setDrawerOpen } from './diagram-io.ts';
import { render } from './render.ts';
import { navigateDecision } from './decision-nav.ts';
import { setMainZoomPercent } from './zoom.ts';
import { highlightPath } from './render-helpers.ts';

document.getElementById('newBtn')!.addEventListener('click', () => {
  if (state.watcher)
    state.watcher.close();
  state.currentName = null;
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  state.diagramScale = null;
  state.currentDecisionId = null;
  restoreTypeMetadata(null);
  codeBox.value = 'flowchart TD\n  B_NEW[New idea]';
  resetEditorHistory(codeBox.value);
  render();
  loadList();
  setDrawerOpen(true);
});
document.getElementById('saveBtn')!.addEventListener('click', saveDiagram);
previousDecisionBtn.addEventListener('click', () => navigateDecision(-1));
nextDecisionBtn.addEventListener('click', () => navigateDecision(1));
zoomInBtn.addEventListener('click', () => setMainZoomPercent(state.mainZoomPercent + MAIN_ZOOM_STEP));
zoomOutBtn.addEventListener('click', () => setMainZoomPercent(state.mainZoomPercent - MAIN_ZOOM_STEP));
zoomResetBtn.addEventListener('click', () => setMainZoomPercent(100));
document.getElementById('resetBtn')!.addEventListener('click', () => {
  chosenAnswers.clear();
  phonePath.length = 0;
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  highlightPath();
  render();
  outputBox.scrollTo({ top: 0, behavior: 'smooth' });
  phoneDiagramBox.scrollTo({ top: 0, behavior: 'smooth' });
});
document.getElementById('undoBtn')!.addEventListener('click', (event) => {
  event.stopPropagation();
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  phonePath.pop();
  render();
});
logBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = logBox.classList.toggle('open');
  logBtn.textContent = open ? 'Log ▼' : 'Log ▲';
});
drawerToggle.addEventListener('click', () => setDrawerOpen(drawer.classList.contains('closed')));
selectBox.addEventListener('change', () => loadDiagram(selectBox.value));

openFileBtn.addEventListener('click', () => openFileInput.click());
openFileInput.addEventListener('change', async () => {
  const file = openFileInput.files![0];
  if (!file)
    return;
  if (state.watcher)
    state.watcher.close();
  state.currentName = null;
  state.phoneFocusNodeId = null;
  state.phoneFocusUsesDecisionContext = false;
  state.phonePreviewChoiceId = null;
  state.diagramScale = null;
  state.currentDecisionId = null;
  codeBox.value = await file.text();
  restoreTypeMetadata(splitEditorMetadata(codeBox.value).metadata);
  resetEditorHistory(codeBox.value);
  selectBox.value = '';
  render();
  loadList();
  setDrawerOpen(true);
  openFileInput.value = '';
});

codeBox.addEventListener('input', () => {
  resetEditorHistory(codeBox.value);
  render();
});
