/**
 * Aviso sonoro para el panel del comercio, generado con Web Audio (sin archivos).
 * Los navegadores bloquean el audio hasta que la persona toca la pantalla una vez;
 * `unlockAudio` se llama desde un clic/tecla para dejarlo listo.
 */
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

export function unlockAudio() {
  const c = getContext();
  if (c && c.state === "suspended") void c.resume().catch(() => undefined);
}

/** Dos tonos cortos (ding-dong). Si el navegador aún no permite audio, falla en silencio. */
export function playNewOrderBeep() {
  const c = getContext();
  if (!c) return;
  void c.resume().catch(() => undefined);
  if (c.state !== "running") return;
  const tone = (freq: number, start: number, dur: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, c.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.35, c.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + start);
    osc.stop(c.currentTime + start + dur + 0.05);
  };
  tone(880, 0, 0.25);
  tone(660, 0.3, 0.35);
}
