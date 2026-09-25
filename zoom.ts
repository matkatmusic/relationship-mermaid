declare const mermaid: any;
import { diagramBox, outputBox, phoneDiagramBox, zoomInBtn, zoomLevel, zoomOutBtn, zoomResetBtn } from './dom.ts';
import type { Edge } from './dom.ts';
import { MAX_MAIN_ZOOM, MIN_MAIN_ZOOM, PHONE_INNER, phonePath, state } from './state.ts';
import { sliceIds } from './graph-slice.ts';
import { chunkSource } from './diagram-source.ts';

export function viewBoxOf(svgText: string) {
  const match = svgText.match(/viewBox="[^"]*?\s([\d.]+)\s([\d.]+)"/)!;
  const [, w, h] = match;
  return { width: Number(w), height: Number(h) };
}

export async function baseScale(edges: Edge[]) {
  const saved = phonePath.splice(0);
  const ids = sliceIds(edges);
  const source = chunkSource(new Set(ids), [], edges);
  phonePath.push(...saved);
  const { svg } = await mermaid.render('diagram-scale-' + (state.renderId++), source);
  const box = viewBoxOf(svg);
  // return Math.min(PHONE_INNER.width / box.width, PHONE_INNER.height / box.height);
  const screenWidth = phoneDiagramBox.clientWidth;
  const screenHeight = phoneDiagramBox.clientHeight;
  return Math.min(screenWidth / box.width, screenHeight / box.height);
}

export function applyMainZoom(preserveViewportCenter = true) {
  zoomLevel.textContent = `${state.mainZoomPercent}%`;
  zoomInBtn.disabled = state.mainZoomPercent >= MAX_MAIN_ZOOM;
  zoomOutBtn.disabled = state.mainZoomPercent <= MIN_MAIN_ZOOM;
  zoomResetBtn.disabled = state.mainZoomPercent === 100;
  const svg = diagramBox.querySelector('svg') as SVGSVGElement | null;
  if (!svg || state.diagramScale === null)
    return;
  const oldWidth = Number.parseFloat(svg.style.width);
  const oldHeight = Number.parseFloat(svg.style.height);
  const centerX = outputBox.scrollLeft + outputBox.clientWidth / 2;
  const centerY = outputBox.scrollTop + outputBox.clientHeight / 2;
  const zoom = state.mainZoomPercent / 100;
  const newWidth = svg.viewBox.baseVal.width * state.diagramScale * zoom;
  const newHeight = svg.viewBox.baseVal.height * state.diagramScale * zoom;
  svg.style.width = newWidth + 'px';
  svg.style.height = newHeight + 'px';
  if (preserveViewportCenter && oldWidth > 0 && oldHeight > 0) {
    outputBox.scrollLeft = centerX * newWidth / oldWidth - outputBox.clientWidth / 2;
    outputBox.scrollTop = centerY * newHeight / oldHeight - outputBox.clientHeight / 2;
  }
}

export function setMainZoomPercent(percent: number) {
  state.mainZoomPercent = Math.max(MIN_MAIN_ZOOM, Math.min(MAX_MAIN_ZOOM, Math.round(percent)));
  applyMainZoom();
}
