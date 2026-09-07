'use client';
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { emptyLine } from '@/lib/builder/types';
import type { BuilderLine } from '@/lib/builder/types';
import {
  BUILDER_STORAGE_KEY,
  DRAFT_VERSION,
  restoreActive,
} from '@/lib/builder/drafts';

const Context = createContext<{
  line: BuilderLine;
  setLine: Dispatch<SetStateAction<BuilderLine>>;
  ready: boolean;
  storageError: string | null;
} | null>(null);
const serverSnapshot = {
  line: emptyLine(),
  ready: false,
  storageError: null as string | null,
};
let snapshot = serverSnapshot;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
function loadWorkingCopy() {
  try {
    const saved = localStorage.getItem(BUILDER_STORAGE_KEY);
    const line = restoreActive(saved);
    snapshot = {
      line: line ?? emptyLine(),
      ready: true,
      storageError:
        saved && !line
          ? 'The working copy could not be restored. Named server drafts are still available.'
          : null,
    };
  } catch {
    snapshot = {
      ...snapshot,
      ready: true,
      storageError:
        'Browser storage is unavailable. Save a named draft before leaving.',
    };
  }
  emit();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!snapshot.ready) loadWorkingCopy();
  return () => {
    listeners.delete(listener);
  };
}
const setLine: Dispatch<SetStateAction<BuilderLine>> = (update) => {
  const line = typeof update === 'function' ? update(snapshot.line) : update;
  let storageError: string | null = null;
  try {
    localStorage.setItem(
      BUILDER_STORAGE_KEY,
      JSON.stringify({ version: DRAFT_VERSION, line }),
    );
  } catch {
    storageError =
      'The working copy could not be saved on this device. Save a named server draft.';
  }
  snapshot = { line, ready: true, storageError };
  emit();
};
const getSnapshot = () => snapshot;
const getServerSnapshot = () => serverSnapshot;
export function BuilderProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <Context.Provider value={{ ...state, setLine }}>
      {children}
    </Context.Provider>
  );
}
export function useBuilder() {
  const value = useContext(Context);
  if (!value) throw new Error('BuilderProvider missing');
  return value;
}
export function BuilderCount() {
  const { line } = useBuilder();
  return (
    <span
      className="ml-1 rounded bg-violet-500/20 px-1.5 text-xs tabular-nums text-violet-200"
      aria-label={`${line.legs.length} selected legs`}
    >
      {line.legs.length}
    </span>
  );
}
