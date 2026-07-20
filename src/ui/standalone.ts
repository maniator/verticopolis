/**
 * Is the app running as an INSTALLED standalone PWA (or an iOS home-screen web
 * app), rather than a normal browser tab?
 *
 * This gates the one place a `target="_blank"` link is unreliable: from an
 * installed standalone window, opening a new tab drops to the system browser
 * (iOS loses the session to Safari; Android/desktop break out of the app), so
 * the in-app "Open full page" link downgrades to opening the in-app compare
 * modal instead, keeping the player in the running sim. A plain browser tab
 * gets the real new-tab navigation.
 *
 * `display-mode: standalone` covers installed PWAs on every current engine;
 * `navigator.standalone` is the older iOS Safari home-screen flag, which the
 * media query historically missed there. Either being true means "installed."
 */
export function isInstalledStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayModeStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosHomeScreen = (window.navigator as { standalone?: boolean }).standalone === true;
  return displayModeStandalone || iosHomeScreen;
}
