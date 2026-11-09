import { describe, expect, it } from "vitest";
import { TOUR_FINISH, TOUR_LANDING, TOUR_STEPS, tourRoleFor, type TourRole } from "./tour-steps";

const ROLES: TourRole[] = ["customer", "business", "courier"];

describe("contenido de la guía", () => {
  it("cada rol tiene una guía corta: entre 4 y 7 pasos (si es larga, nadie la termina)", () => {
    for (const role of ROLES) {
      expect(TOUR_STEPS[role].length, role).toBeGreaterThanOrEqual(4);
      expect(TOUR_STEPS[role].length, role).toBeLessThanOrEqual(7);
    }
  });
  it("ningún paso tiene textos vacíos y los títulos no se repiten dentro de una guía", () => {
    for (const role of ROLES) {
      const titles = TOUR_STEPS[role].map((s) => s.title);
      expect(new Set(titles).size, role).toBe(titles.length);
      for (const s of TOUR_STEPS[role]) {
        expect(s.emoji.trim().length).toBeGreaterThan(0);
        expect(s.title.trim().length).toBeGreaterThan(2);
        expect(s.body.trim().length).toBeGreaterThan(20);
        for (const b of s.bullets ?? []) expect(b.trim().length).toBeGreaterThan(10);
      }
    }
  });
  it("cada paso se lee rápido: cuerpo de a lo sumo ~230 caracteres y máximo 3 viñetas", () => {
    for (const role of ROLES) {
      for (const s of TOUR_STEPS[role]) {
        expect(s.body.length, `${role}: ${s.title}`).toBeLessThanOrEqual(230);
        expect((s.bullets ?? []).length, `${role}: ${s.title}`).toBeLessThanOrEqual(3);
      }
    }
  });
  it("el final de cada guía tiene botón, y la del cliente lleva a Rescates", () => {
    for (const role of ROLES) {
      expect(TOUR_FINISH[role].cta.length).toBeGreaterThan(5);
      expect(TOUR_FINISH[role].title.length).toBeGreaterThan(5);
    }
    expect(TOUR_FINISH.customer.cta).toContain("comencemos esos rescates");
    expect(TOUR_FINISH.customer.goTo).toBe("/rescate");
  });
  it("todas las rutas a las que se lleva existen en la app", () => {
    const known = ["/", "/rescate", "/panel", "/repartidor"];
    for (const role of ROLES) {
      expect(known).toContain(TOUR_LANDING[role]);
      if (TOUR_FINISH[role].goTo) expect(known).toContain(TOUR_FINISH[role].goTo!);
    }
  });
  it("lo que promete la guía coincide con las reglas del producto (tiempos)", () => {
    const business = JSON.stringify(TOUR_STEPS.business);
    expect(business).toContain("25 minutos");
    expect(business).toContain("60");
    expect(JSON.stringify(TOUR_STEPS.courier)).toContain("15 minutos");
  });
  it("la guía del cliente advierte no compartir el código en el chat", () => {
    expect(JSON.stringify(TOUR_STEPS.customer).toLowerCase()).toContain("nunca lo escribas en el chat");
  });
});

describe("tourRoleFor", () => {
  it("devuelve el rol si tiene guía", () => {
    for (const r of ROLES) expect(tourRoleFor(r)).toBe(r);
  });
  it("el admin, sin rol u otros valores no tienen guía", () => {
    for (const r of [null, undefined, "", "admin", "otro"]) expect(tourRoleFor(r as string | null | undefined)).toBeNull();
  });
});
