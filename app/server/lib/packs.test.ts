import { describe, expect, it } from "vitest";
import { computePackExpiry, describePackExpiry, isPackExpired, packDayLabel } from "@contracts/packs";

/** Instante a partir de una hora de pared de Ecuador (UTC-5). */
const ec = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(Date.UTC(y, mo - 1, d, h + 5, mi, s));
/** Hora de pared de Ecuador de un instante, como "AAAA-MM-DD HH:MM". */
const wall = (d: Date) => {
  const l = new Date(d.getTime() - 5 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${l.getUTCFullYear()}-${p(l.getUTCMonth() + 1)}-${p(l.getUTCDate())} ${p(l.getUTCHours())}:${p(l.getUTCMinutes())}`;
};

describe("computePackExpiry", () => {
  it("publicado de mañana: vence hoy a la hora de fin", () => {
    expect(wall(computePackExpiry("19:00", "20:30", ec(2026, 10, 16, 10, 0)))).toBe("2026-10-16 20:30");
  });
  it("publicado ya pasada la hora de fin: vence mañana (antes reaparecía todos los días)", () => {
    expect(wall(computePackExpiry("19:00", "20:30", ec(2026, 10, 16, 21, 0)))).toBe("2026-10-17 20:30");
    expect(wall(computePackExpiry("19:00", "20:30", ec(2026, 10, 16, 20, 30)))).toBe("2026-10-17 20:30");
  });
  it("si faltan menos de 60 s para el fin, vence mañana; con 2 min todavía es hoy", () => {
    expect(wall(computePackExpiry("19:00", "20:30", ec(2026, 10, 16, 20, 29, 30)))).toBe("2026-10-17 20:30");
    expect(wall(computePackExpiry("19:00", "20:30", ec(2026, 10, 16, 20, 28)))).toBe("2026-10-16 20:30");
  });
  it("ventana que cruza la medianoche (22:00–01:00)", () => {
    expect(wall(computePackExpiry("22:00", "01:00", ec(2026, 10, 16, 10, 0)))).toBe("2026-10-17 01:00");
    expect(wall(computePackExpiry("22:00", "01:00", ec(2026, 10, 16, 23, 30)))).toBe("2026-10-17 01:00");
    expect(wall(computePackExpiry("22:00", "01:00", ec(2026, 10, 17, 0, 10)))).toBe("2026-10-17 01:00");
  });
  it("ventana de 24 h (inicio = fin) vence exactamente 24 h después", () => {
    const from = ec(2026, 10, 16, 10, 0);
    expect(computePackExpiry("00:00", "00:00", from).getTime() - from.getTime()).toBe(24 * 3600_000);
  });
  it("cruza fin de mes y de año", () => {
    expect(wall(computePackExpiry("19:00", "20:30", ec(2026, 12, 31, 22, 0)))).toBe("2027-01-01 20:30");
    expect(wall(computePackExpiry("19:00", "20:30", ec(2026, 2, 28, 22, 0)))).toBe("2026-03-01 20:30");
  });
  it("usa la hora de Ecuador aunque la hora UTC ya sea otro día", () => {
    // 21:00 en Ecuador = 02:00 UTC del día siguiente
    expect(wall(computePackExpiry("19:00", "20:30", ec(2026, 10, 16, 21, 0)))).toBe("2026-10-17 20:30");
    expect(wall(computePackExpiry("19:00", "20:30", ec(2026, 10, 16, 19, 0)))).toBe("2026-10-16 20:30");
  });
  it("rechaza horas con formato inválido", () => {
    expect(() => computePackExpiry("7:00", "20:30")).toThrow();
    expect(() => computePackExpiry("19:00", "xx")).toThrow();
  });
});

describe("isPackExpired", () => {
  const now = ec(2026, 10, 16, 12, 0);
  it("vence justo en la fecha y un pack sin fecha cuenta como vencido", () => {
    expect(isPackExpired(ec(2026, 10, 16, 12, 1), now)).toBe(false);
    expect(isPackExpired(ec(2026, 10, 16, 12, 0), now)).toBe(true);
    expect(isPackExpired(ec(2026, 10, 16, 11, 0), now)).toBe(true);
    expect(isPackExpired(null, now)).toBe(true);
    expect(isPackExpired(undefined, now)).toBe(true);
  });
  it("acepta fechas en texto ISO (como llegan por la red)", () => {
    expect(isPackExpired(ec(2026, 10, 16, 13, 0).toISOString(), now)).toBe(false);
  });
});

describe("describePackExpiry", () => {
  const now = ec(2026, 10, 16, 12, 0);
  it("hoy, mañana, otra fecha y vencido", () => {
    expect(describePackExpiry(ec(2026, 10, 16, 20, 30), now)).toBe("hoy a las 20:30");
    expect(describePackExpiry(ec(2026, 10, 17, 20, 30), now)).toBe("mañana a las 20:30");
    expect(describePackExpiry(ec(2026, 10, 20, 8, 5), now)).toBe("el 20/10 a las 08:05");
    expect(describePackExpiry(ec(2026, 10, 16, 11, 0), now)).toBe("venció");
    expect(describePackExpiry(null, now)).toBe("venció");
  });
  it("cuenta el día en hora de Ecuador, no en UTC", () => {
    const lateNight = ec(2026, 10, 16, 23, 0); // ya es 04:00 UTC del 17
    expect(describePackExpiry(ec(2026, 10, 16, 23, 30), lateNight)).toBe("hoy a las 23:30");
  });
});

describe("packDayLabel", () => {
  const now = ec(2026, 10, 16, 12, 0);
  it("día de retiro: hoy, mañana o fecha", () => {
    expect(packDayLabel("19:00", "20:30", ec(2026, 10, 16, 20, 30), now)).toBe("hoy");
    expect(packDayLabel("19:00", "20:30", ec(2026, 10, 17, 20, 30), now)).toBe("mañana");
    expect(packDayLabel("19:00", "20:30", ec(2026, 10, 19, 20, 30), now)).toBe("19/10");
  });
  it("una ventana que cruza la medianoche se retira el día anterior al vencimiento", () => {
    // 22:00–01:00, vence mañana 01:00 → se retira desde esta noche
    expect(packDayLabel("22:00", "01:00", ec(2026, 10, 17, 1, 0), now)).toBe("hoy");
  });
  it("ventana de 24 h siempre es 'hoy' y sin fecha no hay etiqueta", () => {
    expect(packDayLabel("00:00", "00:00", ec(2026, 10, 17, 12, 0), now)).toBe("hoy");
    expect(packDayLabel("19:00", "20:30", null, now)).toBe("");
  });
});
