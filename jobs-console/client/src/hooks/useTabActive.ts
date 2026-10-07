import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Whether the page this subtree belongs to is the active tab. Both tabs stay mounted (the inactive one hidden), so
 * document-level listeners check it and do nothing while their tab is hidden. Defaults to true: outside the tabbed shell
 * (the compare page, tests) everything is active.
 */
export const TabActiveContext = createContext(true);

/** A ref that follows TabActiveContext, for document listeners registered once (their effect deps don't change). */
export function useTabActiveRef(): RefObject<boolean> {
  const active = useContext(TabActiveContext);
  const ref = useRef(active);
  useLayoutEffect(() => {
    ref.current = active;
  }, [active]);
  return ref;
}
