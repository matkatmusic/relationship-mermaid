import { codeBox } from './dom.ts';
import type { PendingRemoval } from './editor-types.ts';

export const MAIN_ZOOM_STEP = 10;
export const MIN_MAIN_ZOOM = 20;
export const MAX_MAIN_ZOOM = 400;
export const chosenAnswers = new Set();
export const phonePath: string[] = []; // decision node ids clicked in phone view, in order
export const MAX_PHONE_NODES = 8;
export const PHONE_INNER = { width: 327, height: 514 };
export const NEW_STATIC_DESTINATION = 'new-static';
export const NEW_DECISION_DESTINATION = 'new-decision';

export const DEFAULT_TYPE_COLORS: Record<string, string> = {
  decision: '#f6d365',
  choice: '#9ed7a4',
  static: '#9fc5e8',
  goal: '#c9b6e4',
};

export const state = {
  renderId: 0,
  currentName: null as string | null,
  watcher: null as EventSource | null,
  currentBottomQ: undefined as string | undefined,
  phoneFocusNodeId: null as string | null,
  phoneFocusUsesDecisionContext: false,
  phonePreviewChoiceId: null as string | null,
  diagramScale: null as number | null,
  mainZoomPercent: 100,
  selectedEditorNodeId: null as string | null,
  currentDecisionId: null as string | null,
  advanceAfterDecisionText: null as { decisionId: string; choiceId: string } | null,
  focusDestinationAfterTextId: null as string | null,
  pendingRemoval: null as PendingRemoval | null,
  editorHistory: [codeBox.value] as string[],
  editorHistoryIndex: 0,
  editorActionPromise: undefined as unknown as Promise<void>,
  editSeq: 0,
  typeColors: { ...DEFAULT_TYPE_COLORS } as Record<string, string>,
  nodeTypes: {} as Record<string, string>,
};

// These were bare globals before the split; mirror each state field onto globalThis so old test evals still work.
for (const key of Object.keys(state)) {
  Object.defineProperty(globalThis, key, {
    get: () => (state as any)[key],
    set: (value) => {
      (state as any)[key] = value;
    },
    configurable: true,
  });
}
