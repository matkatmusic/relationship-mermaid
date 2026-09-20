export type EditorNodeKind = 'question' | 'block' | 'choice';

export const INSPECTOR_TITLES: Record<EditorNodeKind, string> = { question: 'Decision block', block: 'static block', choice: 'choice block' };

export interface EditorNode {
  id: string;
  kind: EditorNodeKind;
  label: string;
  lineIndex: number;
}

export interface EditorEdge {
  from: string;
  to: string;
  label?: string;
  lineIndex: number;
}

export interface EditorGraph {
  lines: string[];
  nodes: Map<string, EditorNode>;
  edges: EditorEdge[];
}

export class EditorValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid diagram:\n${problems.join('\n')}`);
    this.name = 'EditorValidationError';
  }
}

export interface PendingRemoval {
  questionId: string;
  choices: string[];
  index: number;
}

export interface EditorMetadata {
  lastSelectedNodeId: string | null;
  outputScrollLeft?: number;
  outputScrollTop?: number;
  mainZoomPercent?: number;
  typeColors?: Record<string, string>;
  nodeTypes?: Record<string, string>;
  revision?: number;
}

export const EDITOR_METADATA_FENCE = '%%%%====';
export const EDITOR_METADATA_WARNING = 'DO NOT MODIFY - AUTOMATICALLY GENERATED DURING EVERY SAVE';

