// Node/jsdom test for the light/dark theme toggle in assets/js/app.js: every
// fresh visit follows a mocked prefers-color-scheme media query (including
// live changes while the tab stays open), an explicit ☀️/🌙 pick overrides
// that for the rest of the browsing session only (sessionStorage, not
// localStorage - a new visit/session should go back to following the
// system), and the toggle control itself only ever shows two states.
//
// jsdom doesn't implement window.matchMedia at all (see the app.js guard this
// exercises), so it's mocked here with a controllable MediaQueryList stand-in
// that supports addEventListener("change", ...) - this lets tests simulate the
// OS/browser flipping theme while the page is open.
import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!DOCTYPE html><body><div id='theme-toggle-slot'></div></body>", {
  url: "http://localhost/index.html", runScripts: "dangerously",
});
const { window } = dom;
global.window = window;
global.document = window.document;

// --- mock matchMedia BEFORE app.js runs (it reads it once at parse time) ---
let systemDark = false;
const changeListeners = [];
window.matchMedia = () => ({
  get matches() { return systemDark; },
  addEventListener: (type, cb) => { if (type === "change") changeListeners.push(cb); },
});
function simulateSystemChange(toDark) {
  systemDark = toDark;
  changeListeners.forEach((cb) => cb({ matches: systemDark }));
}

for (const rel of ["../assets/js/i18n.js", "../assets/js/app.js"]) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), "utf-8");
  const s = window.document.createElement("script");
  s.textContent = src;
  window.document.body.appendChild(s);
}

const bridge = window.document.createElement("script");
bridge.textContent = "window.__b = { THEME_KEY, getThemeOverride, setThemeOverride, resolveTheme, applyTheme, systemPrefersDark, renderThemeToggle, t };";
window.document.body.appendChild(bridge);
const { THEME_KEY, getThemeOverride, setThemeOverride, resolveTheme, applyTheme, systemPrefersDark, renderThemeToggle, t } = window.__b;

let failures = 0;
function check(label, cond) {
  console.log(`[${cond ? "OK  " : "FAIL"}] ${label}`);
  if (!cond) failures++;
}

// --- fresh visit: no stored override, follows the (mocked) system setting ---
check("No override stored on a fresh visit", getThemeOverride() === null);
check("System reports light by default in this test's mock", !systemPrefersDark());
check("resolveTheme() follows the system setting when there's no override", resolveTheme() === "light");
check("applyTheme() was already called once at app.js load time, setting data-theme", document.documentElement.getAttribute("data-theme") === "light");
check("applyTheme() also sets the native color-scheme to match", document.documentElement.style.colorScheme === "light");

// --- live reaction to a system change while nothing's been picked yet ---
simulateSystemChange(true);
check("Follows the system flipping to dark live (nothing picked yet)", resolveTheme() === "dark" && document.documentElement.getAttribute("data-theme") === "dark");
simulateSystemChange(false);
check("...and back to light again", document.documentElement.getAttribute("data-theme") === "light");

// --- an explicit pick wins over the system setting, and persists for the session ---
setThemeOverride("dark");
check("setThemeOverride('dark') is picked up by getThemeOverride()", getThemeOverride() === "dark");
check("...and persisted to sessionStorage (not localStorage) under THEME_KEY", window.sessionStorage.getItem(THEME_KEY) === "dark" && window.localStorage.getItem(THEME_KEY) === null);
check("...and applied immediately (data-theme updates without a page reload)", document.documentElement.getAttribute("data-theme") === "dark");
simulateSystemChange(true); // system agrees now - shouldn't change anything
check("An explicit pick ignores subsequent system changes that agree with it", document.documentElement.getAttribute("data-theme") === "dark");
simulateSystemChange(false); // system disagrees - the pick should still win
check("An explicit pick ignores system changes that disagree with it too", document.documentElement.getAttribute("data-theme") === "dark");

// --- the toggle control itself: ONE button that flips between the two
// icons/themes on click, not two buttons shown side by side ---
{
  const slot = document.getElementById("theme-toggle-slot");
  const btn = renderThemeToggle(slot);
  check("Toggle renders exactly 1 button, not a pair", slot.querySelectorAll("button").length === 1);
  // 'dark' is still the resolved theme from the earlier explicit-pick checks
  // above, so the button should already show the moon.
  check("Starts showing the moon icon (current theme is dark)", btn.textContent === "🌙");
  check("...with an aria-label/title describing the click action (switch to light), not the icon shown",
        btn.getAttribute("aria-label") === t("theme.switchToLight") && btn.title === t("theme.switchToLight"));

  btn.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("Clicking it applies the light theme immediately", document.documentElement.getAttribute("data-theme") === "light");
  check("...and repaints itself to the sun icon", btn.textContent === "☀️");
  check("...and its label now describes switching to dark instead",
        btn.getAttribute("aria-label") === t("theme.switchToDark") && btn.title === t("theme.switchToDark"));

  btn.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("Clicking it again applies the dark theme immediately", document.documentElement.getAttribute("data-theme") === "dark");
  check("...and repaints itself back to the moon icon", btn.textContent === "🌙");
}

console.log(failures === 0 ? "\nALL THEME TESTS PASSED" : `\n${failures} THEME TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
