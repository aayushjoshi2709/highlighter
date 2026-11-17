/**
 * Scheduling helpers that keep the content script off the page's critical path:
 * background work waits for an idle period and long work is cut into slices.
 */

declare global {
  interface Scheduler {
    yield?: () => Promise<void>;
  }
  // eslint-disable-next-line no-var
  var scheduler: Scheduler | undefined;
}

/** Lets the browser render and handle input before continuing. */
export function yieldToMain(): Promise<void> {
  const s = globalThis.scheduler;
  if (s?.yield) return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resolves when the main thread is idle (or after `timeout` ms at the latest). */
export function whenIdle(timeout = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 50);
  });
}

/**
 * Debounce that still fires at least every `maxWait` ms, so a page that never
 * stops mutating cannot postpone the callback forever.
 */
export function debounceMax(fn: () => void, wait: number, maxWait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstCall = 0;
  const fire = () => {
    timer = undefined;
    firstCall = 0;
    fn();
  };
  return () => {
    const now = Date.now();
    if (!firstCall) firstCall = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, Math.min(wait, firstCall + maxWait - now)));
  };
}
