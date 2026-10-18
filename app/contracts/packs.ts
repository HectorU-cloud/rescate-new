// Vencimiento de los packs de rescate. Compartido entre frontend y backend.
// Ecuador continental es UTC-5 todo el año (sin horario de verano), así que un desfase fijo basta.

const OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_LEAD_MS = 60 * 1000;

function toMinutes(hhmm: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Hora inválida: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
const dayIndex = (ms: number) => Math.floor((ms + OFFSET_MS) / DAY_MS);
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Cuándo vence un pack: la próxima vez que llega la hora de fin de retiro (hora de Ecuador).
 * Si la hora de fin ya pasó hoy (o falta menos de un minuto), vence mañana.
 * Una ventana de 24 h (inicio = fin) vence 24 horas después de publicarla.
 */
export function computePackExpiry(pickupStart: string, pickupEnd: string, from = new Date()): Date {
  const start = toMinutes(pickupStart);
  const end = toMinutes(pickupEnd);
  if (start === end) return new Date(from.getTime() + DAY_MS);
  const local = new Date(from.getTime() + OFFSET_MS); // sus campos UTC muestran la hora de Ecuador
  let candidate =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), Math.floor(end / 60), end % 60) - OFFSET_MS;
  if (candidate - from.getTime() < MIN_LEAD_MS) candidate += DAY_MS;
  return new Date(candidate);
}

/** ¿El pack ya venció? Un pack sin fecha (publicado antes de existir el vencimiento) cuenta como vencido. */
export function isPackExpired(expiresAt: Date | string | null | undefined, now = new Date()) {
  return !expiresAt || new Date(expiresAt).getTime() <= now.getTime();
}

/** "hoy a las 20:30", "mañana a las 20:30", "el 17/10 a las 20:30" o "venció". */
export function describePackExpiry(expiresAt: Date | string | null | undefined, now = new Date()): string {
  if (isPackExpired(expiresAt, now)) return "venció";
  const ms = new Date(expiresAt!).getTime();
  const local = new Date(ms + OFFSET_MS);
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  const diff = dayIndex(ms) - dayIndex(now.getTime());
  if (diff <= 0) return `hoy a las ${time}`;
  if (diff === 1) return `mañana a las ${time}`;
  return `el ${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)} a las ${time}`;
}

/** Día en que se retira el pack: "hoy", "mañana" o "dd/mm". */
export function packDayLabel(
  pickupStart: string,
  pickupEnd: string,
  expiresAt: Date | string | null | undefined,
  now = new Date(),
): string {
  if (!expiresAt) return "";
  if (toMinutes(pickupStart) === toMinutes(pickupEnd)) return "hoy"; // disponible las 24 h
  const crossesMidnight = toMinutes(pickupEnd) < toMinutes(pickupStart);
  const startMs = new Date(expiresAt).getTime() - (crossesMidnight ? DAY_MS : 0);
  const diff = dayIndex(startMs) - dayIndex(now.getTime());
  if (diff <= 0) return "hoy";
  if (diff === 1) return "mañana";
  const local = new Date(startMs + OFFSET_MS);
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}`;
}
