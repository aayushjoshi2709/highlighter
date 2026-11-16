/** Kept free of dependencies: the content script imports this on every page. */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple", "orange"] as const;
export type PresetColor = (typeof HIGHLIGHT_COLORS)[number];
/** A user-picked colour, stored as lowercase "#rrggbb". */
export type CustomColor = `#${string}`;
export const CUSTOM_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

/** Source repository, linked from the popup and Settings as "Fork it on GitHub". */
export const GITHUB_REPO_URL = "https://github.com/aayushjoshi2709/highlighter";
