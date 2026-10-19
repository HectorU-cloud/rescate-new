import { describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { MIME_EXTENSIONS, createStorageClient, keyFromOwnedUrl, presignImageUpload } from "./image-rules";

const s3 = new S3Client({
  region: "auto",
  endpoint: "https://acct.r2.cloudflarestorage.com",
  forcePathStyle: true,
  credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
});
const when = new Date("2026-10-17T12:00:00Z");
const KEY = "businesses/1/product/abcdefghij0123456789.jpg";
const sign = async (over: Partial<Parameters<typeof presignImageUpload>[1]> = {}) =>
  new URL(await presignImageUpload(s3, { bucket: "bucket", key: KEY, contentType: "image/jpeg", size: 100_000, signingDate: when, ...over }));
const signature = (u: URL) => u.searchParams.get("X-Amz-Signature");

describe("presignImageUpload (la firma ata tipo y tamaño)", () => {
  it("firma content-type y content-length además del host (antes solo se firmaba el host)", async () => {
    const headers = (await sign()).searchParams.get("X-Amz-SignedHeaders")!.split(";");
    expect(headers).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
  });
  it("la firma cambia si cambia el tamaño: subir un archivo de otro peso no coincide", async () => {
    expect(signature(await sign({ size: 100_000 }))).not.toBe(signature(await sign({ size: 100_001 })));
    expect(signature(await sign({ size: 100_000 }))).not.toBe(signature(await sign({ size: 5_000_000 })));
  });
  it("la firma cambia si cambia el tipo: no se puede subir un HTML con una URL pedida para JPG", async () => {
    expect(signature(await sign({ contentType: "image/jpeg" }))).not.toBe(signature(await sign({ contentType: "image/png" })));
  });
  it("con los mismos datos la firma es la misma (determinista)", async () => {
    expect(signature(await sign())).toBe(signature(await sign()));
  });
  it("la firma cambia con la clave del archivo (no sirve para otra ruta)", async () => {
    expect(signature(await sign())).not.toBe(signature(await sign({ key: "businesses/2/product/abcdefghij0123456789.jpg" })));
  });
  it("apunta al bucket y la clave, y vence en el tiempo pedido", async () => {
    const u = await sign({ expiresIn: 120 });
    expect(u.pathname).toBe(`/bucket/${KEY}`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("120");
  });
  it("solo existen las extensiones esperadas", () => {
    expect(MIME_EXTENSIONS).toEqual({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });
  });
});

describe("cliente de almacenamiento de la app", () => {
  const appClient = createStorageClient({ region: "auto", endpoint: "https://acct.r2.cloudflarestorage.com", accessKeyId: "AKIATEST", secretAccessKey: "secret" });
  it("la URL firmada NO lleva checksum (calculado sobre un cuerpo vacío haría fallar la subida real en R2)", async () => {
    const u = new URL(await presignImageUpload(appClient, { bucket: "bucket", key: KEY, contentType: "image/jpeg", size: 123_456, signingDate: when }));
    const keys = [...u.searchParams.keys()].map((k) => k.toLowerCase());
    expect(keys.filter((k) => k.includes("checksum"))).toEqual([]);
  });
  it("sigue firmando tipo y tamaño con el cliente real", async () => {
    const u = new URL(await presignImageUpload(appClient, { bucket: "bucket", key: KEY, contentType: "image/jpeg", size: 123_456, signingDate: when }));
    expect(u.searchParams.get("X-Amz-SignedHeaders")!.split(";")).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
  });
  it("usa el endpoint de R2 en modo ruta (bucket en la ruta, no en el dominio)", async () => {
    const u = new URL(await presignImageUpload(appClient, { bucket: "bucket", key: KEY, contentType: "image/jpeg", size: 1, signingDate: when }));
    expect([u.host, u.pathname]).toEqual(["acct.r2.cloudflarestorage.com", `/bucket/${KEY}`]);
  });
});

describe("keyFromOwnedUrl (solo imágenes propias, de la carpeta correcta)", () => {
  const PUB = "https://cdn.test.dev";
  const FOLDER = "businesses/12/product";
  const NAME = "abcdefghijklmnopqrstuvwx";
  const own = `${PUB}/${FOLDER}/${NAME}.jpg`;

  it("acepta una imagen de su carpeta y devuelve la clave", () => {
    expect(keyFromOwnedUrl(PUB, own, FOLDER)).toBe(`${FOLDER}/${NAME}.jpg`);
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/${NAME}.webp`, FOLDER)).toBe(`${FOLDER}/${NAME}.webp`);
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/${NAME}.png`, FOLDER)).toBe(`${FOLDER}/${NAME}.png`);
  });
  it("rechaza imágenes de otro comercio, de otro tipo de carpeta o de un repartidor", () => {
    expect(keyFromOwnedUrl(PUB, `${PUB}/businesses/13/product/${NAME}.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/businesses/12/rescue-pack/${NAME}.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/couriers/12/profile/${NAME}.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/businesses/120/product/${NAME}.jpg`, "businesses/12/product")).toBeNull();
  });
  it("rechaza URLs de terceros, http y dominios que solo se parecen", () => {
    expect(keyFromOwnedUrl(PUB, `https://evil.example/${FOLDER}/${NAME}.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `http://cdn.test.dev/${FOLDER}/${NAME}.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `https://cdn.test.dev.evil.com/${FOLDER}/${NAME}.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `https://cdn.test.dev@evil.com/${FOLDER}/${NAME}.jpg`, FOLDER)).toBeNull();
  });
  it("rechaza parámetros, fragmentos, subcarpetas, '..' y barras codificadas", () => {
    expect(keyFromOwnedUrl(PUB, `${own}?x=1`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${own}#frag`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/sub/${NAME}.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/../13/${NAME}.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/..%2F${NAME}.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/${NAME}.jpg%00.html`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}\\${NAME}.jpg`, FOLDER)).toBeNull();
  });
  it("rechaza extensiones que no son imagen permitida (svg, html, gif…) y nombres raros", () => {
    for (const ext of ["svg", "html", "gif", "js", "jpg.html", "JPG"]) expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/${NAME}.${ext}`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/corto.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/.jpg`, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${PUB}/${FOLDER}/`, FOLDER)).toBeNull();
  });
  it("rechaza vacíos, data URLs y URLs demasiado largas", () => {
    expect(keyFromOwnedUrl("", own, FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, "", FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, "data:image/png;base64,AAAA", FOLDER)).toBeNull();
    expect(keyFromOwnedUrl(PUB, `${own}${"a".repeat(1000)}`, FOLDER)).toBeNull();
  });
});
