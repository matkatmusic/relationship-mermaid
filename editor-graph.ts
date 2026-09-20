import { EDITOR_METADATA_FENCE, EDITOR_METADATA_WARNING, EditorValidationError } from './editor-types.ts';
import type { EditorEdge, EditorGraph, EditorMetadata, EditorNode, EditorNodeKind } from './editor-types.ts';
import { DEFAULT_TYPE_COLORS, state } from './state.ts';
import { codeBox, outputBox } from './dom.ts';
import { showEditorValidationError } from './render-helpers.ts';

export function splitEditorMetadata(source: string) {
  const headerPattern = /(?:^|\r?\n)%%%%====\r?\n%% DO NOT MODIFY - AUTOMATICALLY GENERATED DURING EVERY SAVE\r?\n%% (\{[^\r\n]*\})\r?\n%%%%====/g;
  const matches = [...source.matchAll(headerPattern)];
  if (matches.length === 0)
    return { source, metadata: null as EditorMetadata | null };
  let metadata: EditorMetadata | null = null;
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1]);
    if (parsed && typeof parsed === 'object') {
      const lastSelectedNodeId = typeof parsed.lastSelectedNodeId === 'string' || parsed.lastSelectedNodeId === null
        ? parsed.lastSelectedNodeId
        : null;
      metadata = {
        lastSelectedNodeId,
        outputScrollLeft: typeof parsed.outputScrollLeft === 'number' ? parsed.outputScrollLeft : undefined,
        outputScrollTop: typeof parsed.outputScrollTop === 'number' ? parsed.outputScrollTop : undefined,
        mainZoomPercent: typeof parsed.mainZoomPercent === 'number' ? parsed.mainZoomPercent : undefined,
        typeColors: stringRecord(parsed.typeColors),
        nodeTypes: stringRecord(parsed.nodeTypes),
        revision: typeof parsed.revision === 'number' ? parsed.revision : undefined,
      };
    }
  }
  catch {
    // A malformed generated trailer is discarded and replaced on the next save.
  }
  return { source: source.replace(headerPattern, '').replace(/\s+$/, ''), metadata };
}

export function sourceWithEditorMetadata(source: string) {
  const body = splitEditorMetadata(source).source;
  const metadata: EditorMetadata = {
    lastSelectedNodeId: state.selectedEditorNodeId,
    outputScrollLeft: outputBox.scrollLeft,
    outputScrollTop: outputBox.scrollTop,
    mainZoomPercent: state.mainZoomPercent,
    typeColors: state.typeColors,
    nodeTypes: state.nodeTypes,
    revision: state.editSeq,
  };
  return `${body}\n${EDITOR_METADATA_FENCE}\n%% ${EDITOR_METADATA_WARNING}\n%% ${JSON.stringify(metadata)}\n${EDITOR_METADATA_FENCE}`;
}

export function stringRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string')
      result[key] = entry;
  }
  return result;
}

export function restoreTypeMetadata(metadata: EditorMetadata | null) {
  state.typeColors = { ...DEFAULT_TYPE_COLORS, ...(metadata?.typeColors ?? {}) };
  state.nodeTypes = { ...(metadata?.nodeTypes ?? {}) };
}

export function setEditorActionPromise(promise: Promise<void>) {
  state.editorActionPromise = promise;
  (window as any).editorActionPromise = promise;
}

setEditorActionPromise(Promise.resolve());

export function stripEditorQuotes(text: string) {
  return text.replace(/^"(.*)"$/, '$1');
}

export function parseEditorToken(token: string) {
  const match = token.match(/^([A-Za-z0-9_]+)([\s\S]*)$/);
  if (!match)
    return { id: token, shape: null as null | 'brace' | 'rect' | 'other', label: '' };
  const id = match[1];
  const rest = match[2].trim();
  if (rest.startsWith('{') && rest.endsWith('}'))
    return { id, shape: 'brace' as const, label: stripEditorQuotes(rest.slice(1, -1)) };
  if (rest.startsWith('([') && rest.endsWith('])'))
    return { id, shape: 'other' as const, label: stripEditorQuotes(rest.slice(2, -2)) };
  if (rest.startsWith('[') && rest.endsWith(']'))
    return { id, shape: 'rect' as const, label: stripEditorQuotes(rest.slice(1, -1)) };
  return { id, shape: null as null | 'brace' | 'rect' | 'other', label: '' };
}

export function declarationRequirement(id: string) {
  if (id.startsWith('Q_CHOICE'))
    return 'start with "Q_CHOICE" and use bracket shape []';
  if (id.startsWith('Q_'))
    return 'start with "Q_" and use brace shape {}';
  if (id.startsWith('B_'))
    return 'start with "B_" and use bracket shape []';
  return 'use "Q_" with brace shape {} for a decision, "Q_CHOICE" with bracket shape [] for a choice, or "B_" with bracket shape [] for a static block';
}

export function validateDeclaration(id: string, shape: 'brace' | 'rect' | 'other', lineNumber: number, problems: string[]) {
  const subject = `Line ${lineNumber}: id "${id}"`;
  if (shape === 'other') {
    problems.push(`${subject} uses unsupported rounded/stadium shape; it must ${declarationRequirement(id)}.`);
    return;
  }
  if (id.startsWith('Q_CHOICE')) {
    if (shape !== 'rect')
      problems.push(`${subject} is a choice and must use bracket shape [] (for example, ${id}["Choice"]).`);
    return;
  }
  if (id.startsWith('Q_')) {
    if (shape !== 'brace')
      problems.push(`${subject} is a decision and must use brace shape {} (for example, ${id}{"Decision"}).`);
    return;
  }
  if (id.startsWith('B_')) {
    if (shape !== 'rect')
      problems.push(`${subject} is a static block and must use bracket shape [] (for example, ${id}["Block"]).`);
    return;
  }
  problems.push(`${subject} has a non-compliant prefix; it must ${declarationRequirement(id)}.`);
}

export function parseEditorEdgeLine(line: string) {
  // Mermaid allows several edge segments per line (`A --> B --> C`); split them to match its render.
  const separator = /\s--\s(?:"([^"]*)"|(.+?))\s-->\s|\s-->/g;
  const tokens: string[] = [];
  const labels: (string | undefined)[] = [];
  let tokenStart = 0;
  for (let match; (match = separator.exec(line));) {
    tokens.push(line.slice(tokenStart, match.index).trim());
    labels.push(match[1] ?? match[2]?.trim());
    tokenStart = match.index + match[0].length;
  }
  if (tokens.length === 0)
    return null;
  tokens.push(line.slice(tokenStart).trim());
  if (tokens.some(token => !token))
    return null;
  return tokens.slice(0, -1).map((fromToken, index) => ({ fromToken, label: labels[index], toToken: tokens[index + 1] }));
}

export function declarationSuffixOf(node: EditorNode) {
  if (node.kind === 'question')
    return `{"${node.label}"}`;
  if (node.kind === 'choice')
    return `["${node.label}"]`;
  return `["${node.label}"]`;
}

export function editorGraph(): EditorGraph {
  const lines = codeBox.value.split('\n');
  const declLines = new Map<string, { shape: 'brace' | 'rect' | 'other'; label: string; lineIndex: number }>();
  const edges: EditorEdge[] = [];
  const references = new Map<string, number>();
  const problems: string[] = [];
  const recordDecl = (token: ReturnType<typeof parseEditorToken>, lineIndex: number) => {
    if (token.shape && !declLines.has(token.id))
      declLines.set(token.id, { shape: token.shape, label: token.label, lineIndex });
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    const isSkippable = !line || line.startsWith('flowchart') || line.startsWith('classDef') || line.startsWith('class ') || line.startsWith('%%');
    if (isSkippable)
      continue;
    const parsedEdges = parseEditorEdgeLine(line);
    if (parsedEdges) {
      for (const edge of parsedEdges) {
        const from = parseEditorToken(edge.fromToken);
        const to = parseEditorToken(edge.toToken);
        for (const token of [from, to]) {
          references.set(token.id, lineIndex);
          if (token.shape) {
            problems.push(`Line ${lineIndex + 1}: id "${token.id}" is declared inline on an edge; node declarations must be on their own standalone lines.`);
            validateDeclaration(token.id, token.shape, lineIndex + 1, problems);
          }
        }
        edges.push({ from: from.id, to: to.id, label: edge.label, lineIndex });
      }
    }
    else {
      const decl = parseEditorToken(line);
      if (decl.shape) {
        recordDecl(decl, lineIndex);
        validateDeclaration(decl.id, decl.shape, lineIndex + 1, problems);
      }
    }
  }
  for (const [id, lineIndex] of references) {
    if (!declLines.has(id))
      problems.push(`Line ${lineIndex + 1}: id "${id}" must be declared on its own standalone line and ${declarationRequirement(id)}.`);
  }
  const uniqueProblems = [...new Set(problems)];
  if (uniqueProblems.length) {
    const error = new EditorValidationError(uniqueProblems);
    showEditorValidationError(error);
    throw error;
  }
  const nodes = new Map<string, EditorNode>();
  for (const [id, decl] of declLines) {
    const kind: EditorNodeKind = id.startsWith('Q_CHOICE')
      ? 'choice'
      : id.startsWith('Q_')
        ? 'question'
        : 'block';
    nodes.set(id, { id, kind, label: decl.label, lineIndex: decl.lineIndex });
  }
  return { lines, nodes, edges };
}

