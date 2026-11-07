import { describe, expect, it } from "vitest";
import { BUSINESS_RULES, MILAGRO } from "@contracts/constants";
import { CITIES, cityById, cityIdForPoint, cityLabel, detectCity, nearestCity } from "@contracts/cities";
import { distanceMeters, isInServiceArea } from "@contracts/geo";

const city = (id: string) => cityById(id)!;

describe("lista de ciudades", () => {
  it("los ids son únicos, en minúsculas y sin espacios (viajan en consultas y se guardan en el dispositivo)", () => {
    const ids = CITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(/^[a-z0-9-]+$/.test(id)).toBe(true);
  });
  it("cada ciudad tiene coordenadas dentro de Ecuador continental y un radio razonable", () => {
    for (const c of CITIES) {
      expect(c.lat).toBeGreaterThan(-5);
      expect(c.lat).toBeLessThan(1.5);
      expect(c.lng).toBeGreaterThan(-81.1);
      expect(c.lng).toBeLessThan(-75);
      expect(c.radiusKm).toBeGreaterThan(0);
      expect(c.radiusKm).toBeLessThanOrEqual(25);
    }
  });
  it("Milagro coincide con la constante MILAGRO (así el mapa por defecto y la ciudad no se desfasan)", () => {
    const m = city("milagro");
    expect([m.lat, m.lng, `${m.name}, Ecuador`]).toEqual([MILAGRO.lat, MILAGRO.lng, MILAGRO.name]);
  });
  it("todos los centros caen dentro de la zona de servicio actual (si no, no podría registrarse ningún local allí)", () => {
    for (const c of CITIES) expect(isInServiceArea(c.lat, c.lng), c.id).toBe(true);
  });
  it("no hay ciudades casi duplicadas: los centros están a más de 5 km entre sí", () => {
    for (const a of CITIES) {
      for (const b of CITIES) {
        if (a.id < b.id) expect(distanceMeters(a.lat, a.lng, b.lat, b.lng) / 1000, `${a.id}-${b.id}`).toBeGreaterThan(5);
      }
    }
  });
  it("el radio original alrededor de Milagro no cambia", () => {
    expect(BUSINESS_RULES.serviceAreaRadiusKm).toBe(40);
  });
  it("Babahoyo está en la lista y su centro queda a unos 37 km de Milagro (al borde del radio original)", () => {
    const km = distanceMeters(MILAGRO.lat, MILAGRO.lng, city("babahoyo").lat, city("babahoyo").lng) / 1000;
    expect(km).toBeGreaterThan(35);
    expect(km).toBeLessThan(40);
  });
});

describe("zona de servicio = radio de Milagro + cada ciudad", () => {
  it("todo el área de Babahoyo es zona de servicio, aunque su norte quede más allá de 40 km de Milagro", () => {
    const b = city("babahoyo");
    const northEdge = b.lat + 6 / 111.19; // 6 km al norte del centro (Babahoyo queda al norte de Milagro)
    expect(distanceMeters(MILAGRO.lat, MILAGRO.lng, northEdge, b.lng) / 1000).toBeGreaterThan(40); // fuera del radio original
    expect(isInServiceArea(northEdge, b.lng)).toBe(true); // pero dentro de Babahoyo
  });
  it("lo que ya estaba cubierto sigue cubierto", () => {
    expect(isInServiceArea(MILAGRO.lat, MILAGRO.lng)).toBe(true);
    expect(isInServiceArea(-2.15, -79.6)).toBe(true);
  });
  it("lo lejano sigue fuera: Quito, Machala, la 'isla nula' y el norte de Babahoyo pasado su radio", () => {
    expect(isInServiceArea(-0.18, -78.47)).toBe(false);
    expect(isInServiceArea(-3.26, -79.96)).toBe(false);
    expect(isInServiceArea(0, 0)).toBe(false);
    const b = city("babahoyo");
    expect(isInServiceArea(b.lat + (b.radiusKm + 3) / 111.19, b.lng)).toBe(false);
  });
  it("una ciudad nueva amplía la zona automáticamente: el borde de cada ciudad está dentro, apenas pasado el radio ya no (si no lo cubre otra)", () => {
    for (const c of CITIES) expect(isInServiceArea(c.lat + (c.radiusKm - 0.5) / 111.19, c.lng), c.id).toBe(true);
  });
});

describe("cityById / cityLabel", () => {
  it("encuentra por id y devuelve null si no existe, es vacío o viene nulo", () => {
    expect(cityById("duran")?.name).toBe("Durán");
    for (const bad of ["atlantis", "", null, undefined, "MILAGRO"]) expect(cityById(bad as string | null | undefined)).toBeNull();
  });
  it("el texto de la etiqueta", () => {
    expect(cityLabel(city("milagro"))).toBe("Milagro, Ecuador");
    expect(cityLabel(null)).toBe("Todas las ciudades");
  });
});

describe("detectCity (dónde está una persona)", () => {
  it("el centro de cada ciudad se detecta como esa ciudad", () => {
    for (const c of CITIES) expect(detectCity(c.lat, c.lng).city?.id, c.id).toBe(c.id);
  });
  it("un punto cercano a Milagro (3 km hacia Yaguachi) sigue siendo Milagro", () => {
    expect(detectCity(-2.13, -79.62).city?.id).toBe("milagro");
  });
  it("entre dos poblaciones gana la más cercana", () => {
    expect(detectCity(-2.12, -79.66).city?.id).toBe("yaguachi");
    expect(detectCity(-2.13, -79.63).city?.id).toBe("milagro");
  });
  it("fuera de todas las ciudades devuelve null y cuál es la más cercana", () => {
    for (const [lat, lng] of [[-0.18, -78.47], [-3.26, -79.96], [0, 0], [-2.6, -79.2]]) {
      const r = detectCity(lat, lng);
      expect(r.city, `${lat},${lng}`).toBeNull();
      expect("nearest" in r && r.nearest.id.length > 0).toBe(true);
    }
  });
  it("coordenadas inválidas (NaN, infinito) no cuentan como estar en una ciudad", () => {
    for (const [lat, lng] of [[NaN, -79.5], [-2.1, NaN], [Infinity, 0]]) expect(detectCity(lat, lng).city).toBeNull();
  });
  it("Babahoyo se detecta como Babahoyo y no como Milagro (están a unos 37 km)", () => {
    expect(detectCity(-1.8022, -79.5344).city?.id).toBe("babahoyo");
    expect(detectCity(-1.82, -79.54).city?.id).toBe("babahoyo");
    expect(detectCity(-2.134, -79.594).city?.id).toBe("milagro");
  });
  it("entre Milagro y Babahoyo, a mitad de camino, no es ninguna de las dos (es campo abierto)", () => {
    expect(detectCity(-1.97, -79.56).city).toBeNull();
  });
  it("en el borde del radio: dentro sí, apenas fuera no", () => {
    const m = city("milagro");
    const kmToLat = (km: number) => km / 111.19;
    expect(detectCity(m.lat - kmToLat(m.radiusKm - 0.5), m.lng).city?.id).toBe("milagro");
    expect(detectCity(m.lat - kmToLat(m.radiusKm + 0.5), m.lng).city).toBeNull();
  });
});

describe("cityIdForPoint (a qué ciudad pertenece un local)", () => {
  it("un local siempre pertenece a alguna ciudad, incluso lejos de todas", () => {
    for (const [lat, lng] of [[0, 0], [-2.134, -79.594], [-3.26, -79.96], [-2.4, -79.3]]) expect(cityById(cityIdForPoint(lat, lng))).not.toBeNull();
  });
  it("coincide con la ciudad más cercana", () => {
    expect(cityIdForPoint(-2.1342, -79.5945)).toBe("milagro");
    expect(cityIdForPoint(-2.12, -79.68)).toBe("yaguachi");
    expect(cityIdForPoint(-2.19, -79.88)).toBe("guayaquil");
    expect(cityIdForPoint(-2.17, -79.83)).toBe("duran");
    expect(cityIdForPoint(-1.81, -79.53)).toBe("babahoyo");
    expect(nearestCity(-2.175, -79.4667).city.id).toBe("naranjito");
  });
  it("es consistente: dos locales en el mismo punto van a la misma ciudad", () => {
    expect(cityIdForPoint(-2.15, -79.7)).toBe(cityIdForPoint(-2.15, -79.7));
  });
});
