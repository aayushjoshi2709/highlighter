import { create } from "zustand";
import { EMPTY_FILTERS, type Filters } from "./search";

export type Section = "all" | "web" | "pdf" | "favorites" | "collections" | "documents" | "settings";
export const SECTIONS: { id: Section; label: string }[] = [
  { id: "all", label: "All Highlights" },
  { id: "web", label: "Web Highlights" },
  { id: "pdf", label: "PDF Highlights" },
  { id: "favorites", label: "Favorites" },
  { id: "collections", label: "Collections" },
  { id: "documents", label: "Documents" },
  { id: "settings", label: "Settings" },
];

const fromHash = (): Section => {
  const id = location.hash.slice(1) as Section;
  return SECTIONS.some((s) => s.id === id) ? id : "all";
};

interface DashboardState {
  section: Section;
  filters: Filters;
  selected: Set<string>;
  go(section: Section, filters?: Partial<Filters>): void;
  setFilters(patch: Partial<Filters>): void;
  resetFilters(): void;
  toggleSelected(id: string): void;
  setSelected(ids: string[]): void;
}

export const useDashboard = create<DashboardState>((set) => ({
  section: fromHash(),
  filters: EMPTY_FILTERS,
  selected: new Set(),
  go: (section, filters) => {
    history.replaceState(null, "", `#${section}`);
    set((s) => ({ section, selected: new Set(), filters: filters ? { ...EMPTY_FILTERS, sort: s.filters.sort, ...filters } : s.filters }));
  },
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set((s) => ({ filters: { ...EMPTY_FILTERS, sort: s.filters.sort } })),
  toggleSelected: (id) =>
    set((s) => {
      const selected = new Set(s.selected);
      if (!selected.delete(id)) selected.add(id);
      return { selected };
    }),
  setSelected: (ids) => set({ selected: new Set(ids) }),
}));

window.addEventListener("hashchange", () => useDashboard.setState({ section: fromHash() }));
