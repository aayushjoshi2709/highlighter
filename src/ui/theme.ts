import { getPrefs, onPrefsChanged, type Theme } from "../shared/prefs";

/**
 * Applies the color theme to an extension page. Import this before rendering.
 * The preference lives in chrome.storage (async), so the last value is mirrored
 * in localStorage and applied synchronously to avoid a flash of the wrong theme.
 */
const CACHE_KEY = "wph-theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
let current: Theme = "system";

function readCache(): Theme {
  try {
    const t = localStorage.getItem(CACHE_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme) {
  current = theme;
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && systemDark.matches));
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    // Storage can be unavailable; the theme still applies once prefs load.
  }
}

apply(readCache());
void getPrefs().then((p) => apply(p.theme)).catch(() => {});
onPrefsChanged((p) => apply(p.theme));
systemDark.addEventListener("change", () => apply(current));
