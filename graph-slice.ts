import { codeBox, logBox } from './dom.ts';
import type { Edge } from './dom.ts';
import { MAX_PHONE_NODES, phonePath, state } from './state.ts';
import { isAnswerId } from './render-helpers.ts';

export function parentOf(id: string, edges: Edge[]) {
  let found: Edge | undefined;
  for (const edge of edges) {
    if (edge[1] === id) {
      found = edge;
      break;
    }
  }
  return found![0];
}

export function labelOf(id: string) {
  const trimmedLines = [];
  for (const s of codeBox.value.split('\n')) {
    trimmedLines.push(s.trim());
  }
  const shapePattern = /^[\[{(]/;
  let line;
  for (const s of trimmedLines) {
    const startsWithId = s.startsWith(id);
    const looksLikeNode = shapePattern.test(s.slice(id.length));
    const isMatch = startsWithId && looksLikeNode;
    if (isMatch) {
      line = s;
      break;
    }
  }
  if (!line)
    return id;
  const withoutId = line.slice(id.length);
  const withoutBrackets = withoutId.replace(/^[\[{(]+|[\]})]+$/g, '');
  return withoutBrackets.replace(/"/g, '');
}

export function renderLog(edges: Edge[]) {
  const rows = [];
  for (let i = 0; i < phonePath.length; i++) {
    const id = phonePath[i];
    rows.push(`[${i + 1}] ${labelOf(parentOf(id, edges))}: ${labelOf(id)}`);
  }
  logBox.textContent = ['-- Decision Log for <issue> (<timestamp>) --', ...rows].join('\n');
}

export function contextualDecisionSliceIds(decisionId: string, edges: Edge[]) {
  const reversed = [decisionId];
  const visited = new Set(reversed);
  let node = decisionId;
  for (;;) {
    const incoming = edges.find(([, to]) => to === node);
    if (!incoming)
      break;
    const predecessor = incoming[0];
    if (visited.has(predecessor))
      break;
    reversed.push(predecessor);
    visited.add(predecessor);
    const isPreviousDecision = predecessor.startsWith('Q_') && !predecessor.startsWith('Q_CHOICE');
    if (isPreviousDecision)
      break;
    node = predecessor;
  }
  const ids = reversed.reverse();
  for (const choice of choicesOf(decisionId, edges)) {
    if (!visited.has(choice))
      ids.push(choice);
  }
  return ids;
}

export function sliceIds(edges: Edge[]) {
  if (state.phoneFocusNodeId && state.phoneFocusUsesDecisionContext)
    return contextualDecisionSliceIds(state.phoneFocusNodeId, edges);
  const last = state.phonePreviewChoiceId ?? phonePath[phonePath.length - 1];
  const ids = state.phoneFocusNodeId
    ? [state.phoneFocusNodeId]
    : last
      ? [parentOf(last, edges), last]
      : [edges[0][0]];
  let node = ids[ids.length - 1];
  for (;;) {
    const next = [];
    for (const [from, to] of edges) {
      if (from === node)
        next.push(to);
    }
    if (next.length === 0)
      return ids;
    if (next.length > 1)
      return ids.concat(next);
    node = next[0];
    ids.push(node);
  }
}

// function stubIds(ids, edges) {
//   return ids
//     .flatMap(id => isAnswerId(id, edges) ? edges.filter(([from]) => from === id).map(([, to]) => to) : [])
//     .filter(to => !ids.includes(to));
// }

// function topStubIds(ids, edges, leadIns) {
//   if (!phonePath.length) return [];
//   const visible = new Set([...ids, ...leadIns]);
//   const targets = [ids[0], ...leadIns];
//   return [...new Set(edges.filter(([, to]) => targets.includes(to)).map(([from]) => from).filter(from => !visible.has(from)))];
// }

// function leadInIds(ids, edges) {
//   if (!phonePath.length) return [];
//   const found = [];
//   const queue = [...ids];
//   while (queue.length) {
//     const node = queue.shift();
//     for (const [from] of edges.filter(([, to]) => to === node)) {
//       const isStatic = !isAnswerId(from, edges) && edges.filter(([f]) => f === from).length <= 1;
//       if (!isStatic || ids.includes(from) || found.includes(from)) continue;
//       found.push(from);
//       queue.push(from);
//     }
//   }
//   return found;
// }

export function leadInIds(ids: string[], siblings: string[], edges: Edge[]) {
  const hasDecisionContext = state.phoneFocusUsesDecisionContext || state.phonePreviewChoiceId || phonePath.length;
  if (!hasDecisionContext)
    return [];
  const budget = MAX_PHONE_NODES - new Set([...ids, ...siblings]).size;
  const found: string[] = [];
  const queue = [...ids];
  for (;;) {
    const hasQueued = queue.length > 0;
    if (!hasQueued)
      break;
    const underBudget = found.length < budget;
    if (!underBudget)
      break;
    const node = queue.shift();
    const incoming = [];
    for (const [from, to] of edges) {
      if (to === node)
        incoming.push(from);
    }
    for (const from of incoming) {
      if (found.length >= budget)
        break;
      let outgoingCount = 0;
      for (const [f] of edges) {
        if (f === from)
          outgoingCount++;
      }
      const isStatic = !isAnswerId(from, edges) && outgoingCount <= 1;
      if (!isStatic)
        continue;
      const alreadyKept = ids.includes(from) || siblings.includes(from) || found.includes(from);
      if (alreadyKept)
        continue;
      found.push(from);
      queue.push(from);
    }
  }
  return found;
}

export function siblingIds(ids: string[], edges: Edge[]) {
  const hasDecisionContext = state.phoneFocusUsesDecisionContext || state.phonePreviewChoiceId || phonePath.length;
  if (!hasDecisionContext)
    return [];
  const found = [];
  for (const [from, to] of edges) {
    const isFromFirst = from === ids[0];
    const isNotSecond = to !== ids[1];
    const isSibling = isFromFirst && isNotSecond;
    if (isSibling)
      found.push(to);
  }
  return found;
}

export function choicesOf(id: string, edges: Edge[]) {
  const found = [];
  for (const [from, to] of edges) {
    if (from === id)
      found.push(to);
  }
  return found;
}

// function sliceSource(ids, stubs, topStubs, siblings, leadIns, bottomQ) {
//   const visible = new Set([...ids, ...leadIns]);
//   const keep = new Set([...ids, ...stubs, ...topStubs, ...siblings, ...leadIns]);
//   const top = new Set(topStubs);
//   const allStubs = [...stubs, ...topStubs];
//   const stubSet = new Set(allStubs);
//   const idOf = (line) => line.split(/[\[{(\s]/)[0];
//   const lines = [];
//   for (const raw of codeBox.value.split('\n')) {
//     const line = raw.trim();
//     if (line.startsWith('flowchart') || line.startsWith('classDef')) lines.push(line);
//     else if (line.startsWith('class ')) {
//       const [, list, name] = line.split(' ');
//       const kept = list.split(',').filter(id => visible.has(id));
//       if (kept.length) lines.push(`class ${kept.join(',')} ${name}`);
//     } else if (line.includes('-->')) {
//       const chain = line.split('-->').map(s => s.trim());
//       for (let i = 0; i + 1 < chain.length; i++) {
//         const a = chain[i], b = chain[i + 1];
//         if ((visible.has(a) && keep.has(b)) || (top.has(a) && visible.has(b)))
//           lines.push(stubs.includes(b) ? `${a} -.-> ${b}` : `${a} --> ${b}`);
//       }
//     } else if (keep.has(idOf(line)) && !stubSet.has(idOf(line))) lines.push(line);
//   }
//   for (const sibling of siblings) lines.push(`${ids[0]} -.-> ${sibling}`);
//   for (const id of allStubs) lines.push(`${id}[" "]`);
//   if (allStubs.length) {
//     lines.push('classDef stub fill:transparent,stroke:transparent,color:transparent');
//     lines.push(`class ${allStubs.join(',')} stub`);
//   }
//   if (siblings.length) {
//     lines.push('classDef unchosen fill:#eee,stroke:#bbb,color:#999');
//     lines.push(`class ${siblings.join(',')} unchosen`);
//   }
//   return lines.join('\n');
// }

