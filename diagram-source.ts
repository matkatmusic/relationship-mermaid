import { codeBox } from './dom.ts';
import type { Edge } from './dom.ts';

export function chunkSource(shown: Set<string>, siblings: string[], edges: Edge[]) {
  const initiallyHidden = [];
  for (const [a, b] of edges) {
    const aShown = shown.has(a);
    const bShown = shown.has(b);
    if (aShown !== bShown)
      initiallyHidden.push(aShown ? b : a);
  }
  let hidden = new Set(initiallyHidden);
  const dashed = (a: string, b: string) => siblings.includes(a) || siblings.includes(b) || hidden.has(a) || hidden.has(b);
  const hasShownPredecessor = (id: string) => {
    let found = false;
    for (const [from, to] of edges) {
      const matchesTarget = to === id;
      const fromShown = shown.has(from);
      const isPredecessor = matchesTarget && fromShown;
      if (isPredecessor) {
        found = true;
        break;
      }
    }
    return found;
  };
  const idOf = (line: string) => line.split(/[\[{(\s]/)[0];
  const lines = [];
  const keptPairs: Edge[] = [];
  for (const raw of codeBox.value.split('\n')) {
    const line = raw.trim();
    const isFlowchart = line.startsWith('flowchart');
    const isClassDef = line.startsWith('classDef');
    const isFlowchartOrClassDef = isFlowchart || isClassDef;
    if (isFlowchartOrClassDef)
      lines.push(line);
    else if (line.startsWith('class ')) {
      const [, list, name] = line.split(' ');
      const kept = [];
      for (const id of list.split(',')) {
        const isShown = shown.has(id);
        const isSibling = siblings.includes(id);
        const keepId = isShown && !isSibling;
        if (keepId)
          kept.push(id);
      }
      if (kept.length)
        lines.push(`class ${kept.join(',')} ${name}`);
    }
    else if (line.includes('-->')) {
      const chain = [];
      for (const s of line.split('-->')) {
        chain.push(s.trim());
      }
      for (let i = 0; i + 1 < chain.length; i++) {
        const a = chain[i], b = chain[i + 1];
        const aShown = shown.has(a);
        const bShown = shown.has(b);
        const eitherShown = aShown || bShown;
        if (!eitherShown)
          continue;
        const bHasShownPredecessor = hasShownPredecessor(b);
        const dropForPredecessor = !aShown && bHasShownPredecessor;
        if (dropForPredecessor)
          continue;
        lines.push(`${a} ${dashed(a, b) ? '-.->' : '-->'} ${b}`);
        keptPairs.push([a, b]);
      }
    }
    else if (shown.has(idOf(line)))
      lines.push(line);
  }
  const flatPairs = keptPairs.flat();
  const notShown = [];
  for (const id of flatPairs) {
    if (!shown.has(id))
      notShown.push(id);
  }
  hidden = new Set(notShown);
  for (const id of hidden)
    lines.push(`${id}[" "]`);
  if (hidden.size) {
    lines.push('classDef stub fill:transparent,stroke:transparent,color:transparent');
    lines.push(`class ${[...hidden].join(',')} stub`);
  }
  if (siblings.length) {
    lines.push('classDef unchosen fill:#eee,stroke:#bbb,color:#999');
    lines.push(`class ${siblings.join(',')} unchosen`);
  }
  return lines.join('\n');
}

export function parseEdges(text: string) {
  const edges: Edge[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const isComment = line.startsWith('%%');
    const hasArrow = line.includes('-->');
    const skipLine = isComment || !hasArrow;
    if (skipLine)
      continue;
    const ids = [];
    for (const s of line.split('-->')) {
      ids.push(s.trim());
    }
    for (let i = 0; i + 1 < ids.length; i++)
      edges.push([ids[i], ids[i + 1]]);
  }
  return edges;
}

