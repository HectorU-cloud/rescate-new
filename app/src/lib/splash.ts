const MIN_VISIBLE_MS = 800;
const FADE_MS = 400;

/**
 * Quita la pantalla de carga de index.html con un desvanecido. Se queda un mínimo de tiempo visible para que no
 * parpadee cuando la app carga muy rápido; si la carga es lenta, se va en cuanto la app ya está montada.
 */
export function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const wait = Math.max(50, MIN_VISIBLE_MS - performance.now());
  window.setTimeout(() => {
    splash.classList.add("splash-hide");
    window.setTimeout(() => splash.remove(), FADE_MS);
  }, wait);
}
