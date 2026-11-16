import "fake-indexeddb/auto";

// Minimal chrome.storage stub so modules that notify other contexts can run under test.
const store: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => void Object.assign(store, items),
      remove: async (key: string) => void delete store[key],
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
};
