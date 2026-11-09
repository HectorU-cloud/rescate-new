import { describe, expect, it } from "vitest";
import { TOUR_VERSION, hasSeenTour, markTourSeen, resetTour, subscribeTour, tourKey, type StorageLike } from "./tour-state";

/** Almacenamiento falso, para probar sin navegador. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
  };
}
const broken: StorageLike = {
  getItem: () => { throw new Error("bloqueado"); },
  setItem: () => { throw new Error("bloqueado"); },
  removeItem: () => { throw new Error("bloqueado"); },
};

describe("guía de bienvenida: estado", () => {
  it("una persona nueva no la ha visto", () => {
    expect(hasSeenTour("customer", fakeStorage())).toBe(false);
  });
  it("al terminarla se recuerda en el dispositivo", () => {
    const s = fakeStorage();
    resetTour("business", s);
    markTourSeen("business", s);
    expect(s.data[tourKey("business")]).toBe("1");
    expect(hasSeenTour("business", s)).toBe(true);
    resetTour("business", s);
  });
  it("cada rol tiene su propia guía: ver una no marca las otras", () => {
    const s = fakeStorage();
    resetTour("customer", s); resetTour("courier", s);
    markTourSeen("courier", s);
    expect(hasSeenTour("courier", s)).toBe(true);
    expect(hasSeenTour("customer", s)).toBe(false);
    resetTour("courier", s);
  });
  it("resetTour la deja como no vista (botón 'Ver la guía otra vez')", () => {
    const s = fakeStorage();
    markTourSeen("customer", s);
    expect(hasSeenTour("customer", s)).toBe(true);
    resetTour("customer", s);
    expect(hasSeenTour("customer", s)).toBe(false);
    expect(tourKey("customer") in s.data).toBe(false);
  });
  it("la clave incluye la versión: subirla hace que todos vuelvan a ver la guía", () => {
    expect(tourKey("customer")).toBe(`rescate-tour-v${TOUR_VERSION}-customer`);
    const old = fakeStorage({ "rescate-tour-v0-customer": "1" });
    expect(hasSeenTour("customer", old)).toBe(false);
  });
  it("ignora valores guardados que no sean el esperado", () => {
    const s = fakeStorage({ [tourKey("customer")]: "talvez" });
    resetTour("customer", null);
    expect(hasSeenTour("customer", s)).toBe(false);
  });
  it("si el almacenamiento está bloqueado no rompe y la recuerda durante la sesión (no reaparece en cada pantalla)", () => {
    resetTour("business", broken);
    expect(hasSeenTour("business", broken)).toBe(false);
    markTourSeen("business", broken);
    expect(hasSeenTour("business", broken)).toBe(true);
    resetTour("business", broken);
    expect(hasSeenTour("business", broken)).toBe(false);
  });
  it("sin almacenamiento alguno (null) también funciona", () => {
    resetTour("courier", null);
    expect(hasSeenTour("courier", null)).toBe(false);
    markTourSeen("courier", null);
    expect(hasSeenTour("courier", null)).toBe(true);
    resetTour("courier", null);
  });
  it("avisa a quien esté suscrito cuando se termina o se repite la guía, y deja de avisar al darse de baja", () => {
    const s = fakeStorage();
    let calls = 0;
    const unsubscribe = subscribeTour(() => { calls += 1; });
    markTourSeen("customer", s);
    resetTour("customer", s);
    expect(calls).toBe(2);
    unsubscribe();
    markTourSeen("customer", s);
    expect(calls).toBe(2);
    resetTour("customer", s);
  });
});
