import { describe, expect, it } from "vitest";
import { parseCityChoice, serializeCityChoice } from "./city-storage";

describe("parseCityChoice (lo que se recuerda en el dispositivo)", () => {
  it("lee una ciudad elegida con GPS o a mano", () => {
    expect(parseCityChoice('{"cityId":"milagro","source":"gps"}')).toEqual({ cityId: "milagro", source: "gps" });
    expect(parseCityChoice('{"cityId":"duran","source":"manual","at":1}')).toEqual({ cityId: "duran", source: "manual" });
  });
  it("lee 'todas las ciudades' (a mano o al saltar la pregunta)", () => {
    expect(parseCityChoice('{"cityId":null,"source":"manual"}')).toEqual({ cityId: null, source: "manual" });
    expect(parseCityChoice('{"cityId":null,"source":"skipped"}')).toEqual({ cityId: null, source: "skipped" });
  });
  it("sin nada guardado devuelve null (la app pregunta)", () => {
    expect(parseCityChoice(null)).toBeNull();
    expect(parseCityChoice("")).toBeNull();
  });
  it("texto corrupto o con otra forma devuelve null en vez de romper la pantalla", () => {
    for (const raw of ["{no es json", "[]", "7", "null", '"milagro"', "{}", '{"cityId":"milagro"}', '{"source":"gps"}']) {
      expect(parseCityChoice(raw), raw).toBeNull();
    }
  });
  it("una ciudad que ya no existe en la lista se trata como no elegida (vuelve a preguntar)", () => {
    expect(parseCityChoice('{"cityId":"atlantis","source":"manual"}')).toBeNull();
    expect(parseCityChoice('{"cityId":"MILAGRO","source":"manual"}')).toBeNull();
  });
  it("rechaza combinaciones imposibles y orígenes desconocidos", () => {
    expect(parseCityChoice('{"cityId":"milagro","source":"skipped"}')).toBeNull();
    expect(parseCityChoice('{"cityId":null,"source":"gps"}')).toBeNull();
    expect(parseCityChoice('{"cityId":"milagro","source":"magia"}')).toBeNull();
    expect(parseCityChoice('{"cityId":5,"source":"manual"}')).toBeNull();
  });
  it("lo que se guarda se vuelve a leer igual", () => {
    for (const choice of [{ cityId: "guayaquil", source: "gps" as const }, { cityId: null, source: "manual" as const }, { cityId: null, source: "skipped" as const }]) {
      expect(parseCityChoice(serializeCityChoice(choice))).toEqual(choice);
    }
  });
});
