import { describe, expect, it } from "vitest";
import { CITIES } from "@contracts/cities";
import { buildCityOps } from "./city-ops";

const MILAGRO = { lat: -2.134, lng: -79.594 };
const BABAHOYO = { lat: -1.8022, lng: -79.5344 };
const row = (r: ReturnType<typeof buildCityOps>, id: string) => r.rows.find((x) => x.cityId === id)!;

describe("buildCityOps (resumen por ciudad del admin)", () => {
  it("lista todas las ciudades aunque no haya actividad", () => {
    const r = buildCityOps({ waitingPickups: [], couriers: [] });
    expect(r.rows.map((x) => x.cityId)).toEqual(CITIES.map((c) => c.id));
    expect(r.rows.every((x) => x.waitingOrders === 0 && x.availableCouriers === 0)).toBe(true);
    expect(r.couriersWithoutCity).toBe(0);
  });
  it("cuenta los pedidos esperando en la ciudad de su local", () => {
    const r = buildCityOps({ waitingPickups: [MILAGRO, MILAGRO, BABAHOYO], couriers: [] });
    expect(row(r, "milagro").waitingOrders).toBe(2);
    expect(row(r, "babahoyo").waitingOrders).toBe(1);
    expect(row(r, "guayaquil").waitingOrders).toBe(0);
  });
  it("cuenta solo repartidores conectados en cada ciudad", () => {
    const r = buildCityOps({
      waitingPickups: [],
      couriers: [
        { cityId: "milagro", available: true },
        { cityId: "milagro", available: true },
        { cityId: "milagro", available: false }, // desconectado: no cuenta
        { cityId: "babahoyo", available: true },
      ],
    });
    expect(row(r, "milagro").availableCouriers).toBe(2);
    expect(row(r, "babahoyo").availableCouriers).toBe(1);
    expect(r.couriersWithoutCity).toBe(0);
  });
  it("detecta el desbalance: pedidos esperando y ningún repartidor en esa ciudad", () => {
    const r = buildCityOps({ waitingPickups: [BABAHOYO, BABAHOYO], couriers: [{ cityId: "milagro", available: true }] });
    expect(row(r, "babahoyo")).toMatchObject({ waitingOrders: 2, availableCouriers: 0 });
    expect(row(r, "milagro")).toMatchObject({ waitingOrders: 0, availableCouriers: 1 });
  });
  it("cuenta aparte a los aprobados sin ciudad (o con una que ya no existe), estén conectados o no", () => {
    const r = buildCityOps({
      waitingPickups: [],
      couriers: [
        { cityId: null, available: true },
        { cityId: null, available: false },
        { cityId: "atlantis", available: true },
        { cityId: "duran", available: true },
      ],
    });
    expect(r.couriersWithoutCity).toBe(3);
    expect(row(r, "duran").availableCouriers).toBe(1);
  });
});
