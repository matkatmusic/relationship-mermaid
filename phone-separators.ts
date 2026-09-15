import { diagramBox, outputBox, phoneDiagramBox } from './dom.ts';
import type { Edge } from './dom.ts';
import { phonePath, state } from './state.ts';
import { choicesOf } from './graph-slice.ts';
import { centerNodeInViewport } from './decision-nav.ts';


// function updateSvgSizingForPhoneMode() {
//   const svg = diagramBox.querySelector('svg');
//   if (!svg) return;
//   if (!outputBox.classList.contains('phone')) {
//     svg.style.width = '';
//     svg.style.height = '';
//     return;
//   }
//   const viewBox = svg.getAttribute('viewBox');
//   if (!viewBox) return;
//   const [, , vbWidth, vbHeight] = viewBox.split(' ').map(Number);
//   svg.style.width = vbWidth + 'px';
//   svg.style.height = vbHeight + 'px';
// }

// function drawSeparator(ids) {
//   if (!phonePath.length || ids.length < 3) return;
//   const svg = diagramBox.querySelector('svg');
//   const nodeEl = (id) => diagramBox.querySelector('[id*="flowchart-' + id + '-"]');
//   const yOf = (el) => Number(el.getAttribute('transform').match(/translate\([^,]+,\s*([^)]+)\)/)[1]);
//   const chosen = nodeEl(ids[1]);
//   const next = nodeEl(ids[2]);
//   const chosenBottom = yOf(chosen) + chosen.getBBox().height / 2;
//   const nextTop = yOf(next) - next.getBBox().height / 2;
//   const [x, , width] = svg.getAttribute('viewBox').split(' ').map(Number);
//   const y = (chosenBottom + nextTop) / 2;
//   const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
//   line.setAttribute('x1', x); line.setAttribute('x2', x + width);
//   line.setAttribute('y1', y); line.setAttribute('y2', y);
//   line.setAttribute('stroke', '#888'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '8 6');
//   line.setAttribute('class', 'separator');
//   svg.appendChild(line);
// }

export function drawSeparatorBetween(topId: string, belowIds: string[], label: string) {
  const svg = phoneDiagramBox.querySelector('svg')!;
  const nodeEl = (id: string) => phoneDiagramBox.querySelector('[id*="flowchart-' + id + '-"]') as SVGGraphicsElement | null;
  const yOf = (el: SVGGraphicsElement) => Number(el.getAttribute('transform')!.match(/translate\([^,]+,\s*([^)]+)\)/)![1]);
  const top = nodeEl(topId);
  const belowEls: SVGGraphicsElement[] = [];
  for (const id of belowIds) {
    const el = nodeEl(id);
    if (el)
      belowEls.push(el);
  }
  const hasTopAndBelow = top && belowEls.length;
  if (!hasTopAndBelow)
    return;
  const topBottom = yOf(top!) + top!.getBBox().height / 2;
  const belowTops = [];
  for (const el of belowEls) {
    belowTops.push(yOf(el) - el.getBBox().height / 2);
  }
  const belowTop = Math.min(...belowTops);
  const viewBoxParts = svg.getAttribute('viewBox')!.split(' ');
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, , width] = viewBoxNumbers;
  const y = (topBottom + belowTop) / 2;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  // ponytail: overshoot the viewBox so the line spans the whole phone width; the svg clips it
  // line.setAttribute('x1', String(x - 10000)); line.setAttribute('x2', String(x + width + 10000));
  // line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
  // line.setAttribute('stroke', '#888'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '8 6');
  const lineAttrs: [string, string][] = [
    ['x1', String(x - 10000)],
    ['x2', String(x + width + 10000)],
    ['y1', String(y)],
    ['y2', String(y)],
    ['stroke', '#888'],
    ['stroke-width', '2'],
    ['stroke-dasharray', '8 6'],
  ];
  for (const [name, value] of lineAttrs) {
    line.setAttribute(name, value);
  }
  line.setAttribute('class', 'separator');
  svg.appendChild(line);
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  const screenToSvg = svg.getScreenCTM()!.inverse();
  const svgLeft = new DOMPoint(svg.getBoundingClientRect().left, 0).matrixTransform(screenToSvg).x;
  // text.setAttribute('x', String(x + 8));
  text.setAttribute('x', String(svgLeft + 8));
  text.setAttribute('y', String(y - 6));
  // text.setAttribute('font-size', '14');
  // text.setAttribute('fill', '#333');
  const isOpenDecision = label === 'open decision';
  const fill = isOpenDecision ? '#2e7d32' : '#c62828';
  text.setAttribute('fill', fill);
  text.setAttribute('stroke', '#000');
  text.setAttribute('stroke-width', '0.6');
  text.setAttribute('paint-order', 'stroke');
  text.setAttribute('font-weight', 'bold');
  text.setAttribute('font-size', '16');
  text.setAttribute('font-family', 'sans-serif');
  text.setAttribute('class', 'separator-label');
  text.textContent = label;
  svg.appendChild(text);
}

export function drawLastDecisionMask(ids: string[], edges: Edge[], openDecisionId: string | undefined): void {
  const svg = phoneDiagramBox.querySelector('svg')!;
  const nodeEl = (id: string) => phoneDiagramBox.querySelector('[id*="flowchart-' + id + '-"]') as SVGGraphicsElement | null;
  const yOf = (el: SVGGraphicsElement) => Number(el.getAttribute('transform')!.match(/translate\([^,]+,\s*([^)]+)\)/)![1]);
  const top = nodeEl(ids[0]);
  const choiceEls: SVGGraphicsElement[] = [];
  for (const id of choicesOf(ids[0], edges)) {
    const el = nodeEl(id);
    if (el)
      choiceEls.push(el);
  }
  const hasTopAndChoices = top && choiceEls.length;
  if (!hasTopAndChoices)
    return;
  const bottoms = [];
  for (const el of choiceEls) {
    bottoms.push(yOf(el) + el.getBBox().height / 2);
  }
  let maskBottom = Math.max(...bottoms) + 12;
  if (openDecisionId && openDecisionId !== ids[0]) {
    const protectedEls: SVGGraphicsElement[] = [];
    for (const id of [openDecisionId, ...choicesOf(openDecisionId, edges)]) {
      const el = nodeEl(id);
      if (el)
        protectedEls.push(el);
    }
    if (protectedEls.length) {
      const protectedTop = Math.min(...protectedEls.map(el => yOf(el) - el.getBBox().height / 2));
      maskBottom = Math.min(maskBottom, protectedTop - 4);
    }
  }
  const viewBoxParts = svg.getAttribute('viewBox')!.split(' ');
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, y, width] = viewBoxNumbers;
  const maskHeight = Math.max(0, maskBottom - y);
  if (maskHeight === 0)
    return;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x - 10000));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(width + 20000));
  rect.setAttribute('height', String(maskHeight));
  rect.setAttribute('fill', 'rgba(0,0,0,0.25)');
  rect.setAttribute('class', 'last-decision-mask');
  rect.setAttribute('pointer-events', 'none');
  svg.appendChild(rect);
}

export function drawSeparator(ids: string[], leadIns: string[]) {
  const svg = phoneDiagramBox.querySelector('svg')!;
  const nodeEl = (id: string) => phoneDiagramBox.querySelector('[id*="flowchart-' + id + '-"]') as SVGGraphicsElement | null;
  const yOf = (el: SVGGraphicsElement) => Number(el.getAttribute('transform')!.match(/translate\([^,]+,\s*([^)]+)\)/)![1]);
  const topDp = nodeEl(ids[0]);
  if (!topDp)
    return;
  const topOfDp = yOf(topDp) - topDp.getBBox().height / 2;
  const leadInEls: SVGGraphicsElement[] = [];
  for (const id of leadIns) {
    const el = nodeEl(id);
    if (el)
      leadInEls.push(el);
  }
  const above: SVGGraphicsElement[] = [];
  for (const el of leadInEls) {
    const isAboveTop = yOf(el) + el.getBBox().height / 2 < topOfDp;
    if (isAboveTop)
      above.push(el);
  }
  if (above.length === 0)
    return;
  const aboveBottoms = [];
  for (const el of above) {
    aboveBottoms.push(yOf(el) + el.getBBox().height / 2);
  }
  const aboveBottom = Math.max(...aboveBottoms);
  const y = (aboveBottom + topOfDp) / 2;
  const viewBoxParts = svg.getAttribute('viewBox')!.split(' ');
  const viewBoxNumbers = [];
  for (const part of viewBoxParts) {
    viewBoxNumbers.push(Number(part));
  }
  const [x, , width] = viewBoxNumbers;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  // line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x + width));
  // line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
  // line.setAttribute('stroke', '#888'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '8 6');
  const lineAttrs: [string, string][] = [
    ['x1', String(x)],
    ['x2', String(x + width)],
    ['y1', String(y)],
    ['y2', String(y)],
    ['stroke', '#888'],
    ['stroke-width', '2'],
    ['stroke-dasharray', '8 6'],
  ];
  for (const [name, value] of lineAttrs) {
    line.setAttribute(name, value);
  }
  line.setAttribute('class', 'separator');
  svg.appendChild(line);
}

export function scrollChoicesIntoView(bottomQ: string | undefined, edges: Edge[]): void {
  if (state.phoneFocusNodeId) {
    centerNodeInViewport(phoneDiagramBox, phoneDiagramBox, state.phoneFocusNodeId);
    return;
  }
  const atStart = phonePath.length === 0;
  if (atStart) {
    phoneDiagramBox.scrollTop = 0;
    return;
  }
  if (!bottomQ)
    return;
  let lastChoice: Element | null = null;
  for (const [from, to] of edges) {
    const isChoice = from === bottomQ;
    if (isChoice)
      lastChoice = phoneDiagramBox.querySelector('[id*="flowchart-' + to + '-"]');
  }
  if (!lastChoice)
    return;
  lastChoice.scrollIntoView({ block: 'end' });
}

