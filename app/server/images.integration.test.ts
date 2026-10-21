/**
 * Pruebas de integración (MySQL real + almacenamiento S3 falso en memoria) de las fotos:
 * tamaño y tipo atados a la firma, solo imágenes propias, y borrado de las reemplazadas.
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts).
 * Nunca usan tu R2 real: el almacenamiento es un servidor local que solo anota las peticiones.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("fotos: tamaño, propiedad y limpieza (MySQL real + S3 falso)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let appRouter: (typeof import("./router"))["appRouter"];
  let fakeS3: http.Server;
  const requests: Array<{ method: string; url: string }> = [];
  let failDeletes = false;
  const PUBLIC = "https://cdn.test.dev";

  const tag = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let seq = 0;
  const created = { users: [] as number[], businesses: [] as number[], products: [] as number[], packs: [] as number[] };

  beforeAll(async () => {
    fakeS3 = http.createServer((req, res) => {
      requests.push({ method: req.method ?? "", url: req.url ?? "" });
      res.statusCode = req.method === "DELETE" ? (failDeletes ? 500 : 204) : 200;
      res.end();
    });
    await new Promise<void>((resolve) => fakeS3.listen(0, "127.0.0.1", resolve));
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    process.env.S3_ENDPOINT = `http://127.0.0.1:${(fakeS3.address() as AddressInfo).port}`;
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ACCESS_KEY_ID = "AKIATEST";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_PUBLIC_URL = PUBLIC;
    process.env.S3_REGION = "auto";
    db = (await import("./queries/connection")).getDb();
    S = await import("@db/schema");
    appRouter = (await import("./router")).appRouter;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fakeS3?.close(() => resolve()));
    if (!db) return;
    if (created.packs.length) await db.delete(S.rescuePacks).where(inArray(S.rescuePacks.id, created.packs));
    if (created.products.length) await db.delete(S.products).where(inArray(S.products.id, created.products));
    if (created.businesses.length) await db.delete(S.businesses).where(inArray(S.businesses.id, created.businesses));
    if (created.users.length) await db.delete(S.users).where(inArray(S.users.id, created.users));
  });

  beforeEach(() => { requests.length = 0; failDeletes = false; });

  // ------------------------------------------------------------------ ayudantes
  type User = Awaited<ReturnType<typeof mkUser>>;
  async function mkUser(kind: "customer" | "business" | "courier") {
    const [{ id }] = await db.insert(S.users).values({ unionId: `${tag}-u${seq++}`, name: `${tag} ${kind}`, appRole: kind }).$returningId();
    created.users.push(id);
    return (await db.select().from(S.users).where(eq(S.users.id, id)))[0];
  }
  async function mkBusinessOwner() {
    const owner = await mkUser("business");
    const [{ id }] = await db.insert(S.businesses).values({
      ownerId: owner.id, name: `${tag} local ${seq++}`, category: "test", address: "Calle 1", lat: -2.134, lng: -79.594,
      approvalStatus: "approved", locationConfirmed: true,
    }).$returningId();
    created.businesses.push(id);
    return { owner, bizId: id };
  }
  const callerFor = (user: User) => appRouter.createCaller({ req: new Request("http://localhost/test"), resHeaders: new Headers(), user });
  async function failure(p: Promise<unknown>) {
    try { await p; } catch (e) { return e as { code: string; message: string }; }
    throw new Error("se esperaba un error y la operación tuvo éxito");
  }
  const name = () => randomBytes(18).toString("base64url"); // 24 caracteres seguros, como los que genera la app
  const ownUrl = (folder: string, ext = "jpg") => `${PUBLIC}/${folder}/${name()}.${ext}`;
  const keyOf = (url: string) => url.slice(PUBLIC.length + 1);
  const deletes = () => requests.filter((r) => r.method === "DELETE").map((r) => decodeURIComponent(r.url.split("?")[0]));
  const productFolder = (bizId: number) => `businesses/${bizId}/product`;
  const packFolder = (bizId: number) => `businesses/${bizId}/rescue-pack`;
  const courierFolder = (id: number) => `couriers/${id}/profile`;
  const newProduct = (c: ReturnType<typeof callerFor>, imageUrl?: string, extra: Record<string, unknown> = {}) =>
    c.business.upsertProduct({ name: `${tag} plato`, price: 3, ...(imageUrl ? { imageUrl } : {}), ...extra });
  async function mkProductRow(businessId: number, imageUrl: string | null) {
    const [{ id }] = await db.insert(S.products).values({ businessId, name: `${tag} legacy`, price: 3, imageUrl }).$returningId();
    created.products.push(id);
    return id;
  }
  const productRow = async (id: number) => (await db.select().from(S.products).where(eq(S.products.id, id)))[0];

  // ------------------------------------------------------------------ pedir la subida
  describe("pedir la URL de subida", () => {
    it("la URL firmada ata tipo y tamaño, y apunta a la carpeta del local", async () => {
      const { owner, bizId } = await mkBusinessOwner();
      const r = await callerFor(owner).business.createImageUpload({ contentType: "image/jpeg", kind: "product", size: 123_456 });
      const signed = new URL(r.uploadUrl).searchParams.get("X-Amz-SignedHeaders")!.split(";");
      expect(signed).toEqual(expect.arrayContaining(["content-length", "content-type"]));
      expect(r.imageUrl.startsWith(`${PUBLIC}/staging/${productFolder(bizId)}/`)).toBe(true);
      expect(r.key.startsWith(`staging/${productFolder(bizId)}/`)).toBe(true);
      expect(r.key.endsWith(".jpg")).toBe(true);
    });
    it("el tamaño es obligatorio y debe ser un entero entre 1 byte y 2 MB", async () => {
      const { owner } = await mkBusinessOwner();
      const c = callerFor(owner);
      const base = { contentType: "image/jpeg" as const, kind: "product" as const };
      for (const size of [0, -5, 1.5, 2 * 1024 * 1024 + 1, 50_000_000, Number.NaN]) {
        expect((await failure(c.business.createImageUpload({ ...base, size }))).code).toBe("BAD_REQUEST");
      }
      // @ts-expect-error: sin tamaño
      expect((await failure(c.business.createImageUpload(base))).code).toBe("BAD_REQUEST");
      expect((await c.business.createImageUpload({ ...base, size: 2 * 1024 * 1024 })).uploadUrl).toContain("X-Amz-Signature");
    });
    it("solo acepta JPG, PNG y WebP", async () => {
      const { owner } = await mkBusinessOwner();
      // @ts-expect-error: tipo no permitido
      expect((await failure(callerFor(owner).business.createImageUpload({ contentType: "image/svg+xml", kind: "product", size: 1000 }))).code).toBe("BAD_REQUEST");
      // @ts-expect-error: tipo no permitido
      expect((await failure(callerFor(owner).business.createImageUpload({ contentType: "text/html", kind: "product", size: 1000 }))).code).toBe("BAD_REQUEST");
    });
    it("máximo 30 subidas por hora por usuario; otro usuario no se ve afectado", async () => {
      const a = await mkBusinessOwner(); const b = await mkBusinessOwner();
      const ca = callerFor(a.owner);
      for (let i = 0; i < 30; i++) await ca.business.createImageUpload({ contentType: "image/png", kind: "rescue-pack", size: 1000 });
      const e = await failure(ca.business.createImageUpload({ contentType: "image/png", kind: "rescue-pack", size: 1000 }));
      expect([e.code, e.message]).toEqual(["TOO_MANY_REQUESTS", expect.stringMatching(/muchas fotos/)]);
      expect((await callerFor(b.owner).business.createImageUpload({ contentType: "image/png", kind: "rescue-pack", size: 1000 })).key).toBeTruthy();
    });
    it("quien no tiene un local no puede pedir subidas", async () => {
      const e = await failure(callerFor(await mkUser("customer")).business.createImageUpload({ contentType: "image/jpeg", kind: "product", size: 1000 }));
      expect(e.code).toBe("PRECONDITION_FAILED");
      expect(e.message).toMatch(/negocio/i);
      expect(requests).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------ productos
  describe("fotos de productos", () => {
    it("acepta una imagen subida a la carpeta de productos del propio local", async () => {
      const { owner, bizId } = await mkBusinessOwner();
      const url = ownUrl(productFolder(bizId));
      const { id } = await newProduct(callerFor(owner), url);
      created.products.push(id);
      expect((await productRow(id)).imageUrl).toBe(url);
    });
    it("rechaza imágenes de terceros, de otros comercios, de otra carpeta, http, con parámetros o data URLs", async () => {
      const { owner, bizId } = await mkBusinessOwner(); const other = await mkBusinessOwner();
      const c = callerFor(owner);
      const bad = [
        "https://evil.example/pixel.png",
        "https://images.unsplash.com/photo.jpg",
        ownUrl(productFolder(other.bizId)),
        ownUrl(packFolder(bizId)),
        ownUrl(courierFolder(owner.id)),
        `http://cdn.test.dev/${productFolder(bizId)}/${name()}.jpg`,
        `${ownUrl(productFolder(bizId))}?track=1`,
        ownUrl(productFolder(bizId), "svg"),
        "data:image/png;base64,iVBORw0KGgo=",
      ];
      for (const url of bad) expect((await failure(newProduct(c, url))).code, url).toBe("BAD_REQUEST");
    });
    it("sin imagen sigue funcionando", async () => {
      const { owner } = await mkBusinessOwner();
      const { id } = await newProduct(callerFor(owner));
      created.products.push(id);
      expect((await productRow(id)).imageUrl).toBeNull();
    });

    describe("productos con imágenes antiguas (guardadas antes de este cambio)", () => {
      it("editar otros datos conservando la misma imagen antigua sigue siendo válido", async () => {
        const { owner, bizId } = await mkBusinessOwner();
        const legacy = `https://images.unsplash.com/photo-legacy-${name()}.jpg`; // única por test: si no, otra fila la seguiría usando y taparía la comprobación
        const id = await mkProductRow(bizId, legacy);
        await newProduct(callerFor(owner), legacy, { id, price: 4.5 });
        const row = await productRow(id);
        expect([row.imageUrl, row.price]).toEqual([legacy, 4.5]);
        expect(deletes()).toEqual([]); // una URL ajena nunca se intenta borrar
      });
      it("cambiarla por otra imagen ajena sigue prohibido, pero por una propia sí", async () => {
        const { owner, bizId } = await mkBusinessOwner();
        const id = await mkProductRow(bizId, `https://images.unsplash.com/photo-legacy-${name()}.jpg`); // única por test (ver arriba)
        const c = callerFor(owner);
        expect((await failure(newProduct(c, "https://evil.example/otra.png", { id }))).code).toBe("BAD_REQUEST");
        const own = ownUrl(productFolder(bizId));
        await newProduct(c, own, { id });
        expect((await productRow(id)).imageUrl).toBe(own);
        expect(deletes()).toEqual([]); // la antigua era ajena: no se borra nada
      });
    });

    it("si la imagen antigua apuntaba a la carpeta de OTRO comercio (se permitía copiar URLs), reemplazarla nunca borra la foto del otro", async () => {
      const mine = await mkBusinessOwner(); const theirs = await mkBusinessOwner();
      const theirPhoto = ownUrl(productFolder(theirs.bizId));
      const id = await mkProductRow(mine.bizId, theirPhoto);
      await newProduct(callerFor(mine.owner), ownUrl(productFolder(mine.bizId)), { id });
      expect(deletes()).toEqual([]);
      const bad = ownUrl(courierFolder(mine.owner.id), "webp");
      const id2 = await mkProductRow(mine.bizId, bad); // apuntaba a una carpeta de repartidor
      await newProduct(callerFor(mine.owner), ownUrl(productFolder(mine.bizId)), { id: id2 });
      expect(deletes()).toEqual([]);
    });

    describe("limpieza de la foto reemplazada", () => {
      it("al reemplazar la foto se borra la anterior del almacenamiento (y solo esa)", async () => {
        const { owner, bizId } = await mkBusinessOwner();
        const a = ownUrl(productFolder(bizId)); const b = ownUrl(productFolder(bizId));
        const { id } = await newProduct(callerFor(owner), a); created.products.push(id);
        expect(deletes()).toEqual([]);
        await newProduct(callerFor(owner), b, { id });
        expect(deletes()).toEqual([`/test-bucket/${keyOf(a)}`]);
        expect((await productRow(id)).imageUrl).toBe(b);
      });
      it("al quitar la foto también se borra", async () => {
        const { owner, bizId } = await mkBusinessOwner();
        const a = ownUrl(productFolder(bizId));
        const { id } = await newProduct(callerFor(owner), a); created.products.push(id);
        await newProduct(callerFor(owner), undefined, { id });
        expect(deletes()).toEqual([`/test-bucket/${keyOf(a)}`]);
        expect((await productRow(id)).imageUrl).toBeNull();
      });
      it("guardar de nuevo con la misma foto no borra nada", async () => {
        const { owner, bizId } = await mkBusinessOwner();
        const a = ownUrl(productFolder(bizId));
        const { id } = await newProduct(callerFor(owner), a); created.products.push(id);
        await newProduct(callerFor(owner), a, { id, price: 5 });
        expect(deletes()).toEqual([]);
      });
      it("si otro producto usa la misma foto, no se borra", async () => {
        const { owner, bizId } = await mkBusinessOwner();
        const shared = ownUrl(productFolder(bizId));
        const first = await newProduct(callerFor(owner), shared); const second = await newProduct(callerFor(owner), shared);
        created.products.push(first.id, second.id);
        await newProduct(callerFor(owner), ownUrl(productFolder(bizId)), { id: first.id });
        expect(deletes()).toEqual([]);
        await newProduct(callerFor(owner), ownUrl(productFolder(bizId)), { id: second.id }); // ya nadie la usa
        expect(deletes()).toEqual([`/test-bucket/${keyOf(shared)}`]);
      });
      it("si falla el borrado en el almacenamiento, el guardado igual funciona", async () => {
        const { owner, bizId } = await mkBusinessOwner();
        const a = ownUrl(productFolder(bizId)); const b = ownUrl(productFolder(bizId));
        const { id } = await newProduct(callerFor(owner), a); created.products.push(id);
        failDeletes = true;
        await expect(newProduct(callerFor(owner), b, { id })).resolves.toMatchObject({ id });
        expect((await productRow(id)).imageUrl).toBe(b);
      });
      it("no se puede editar un producto de otro local (ni borrar su foto)", async () => {
        const mine = await mkBusinessOwner(); const theirs = await mkBusinessOwner();
        const theirUrl = ownUrl(productFolder(theirs.bizId));
        const id = await mkProductRow(theirs.bizId, theirUrl);
        await newProduct(callerFor(mine.owner), ownUrl(productFolder(mine.bizId)), { id });
        expect((await productRow(id)).imageUrl).toBe(theirUrl);
        expect(deletes()).toEqual([]);
      });
    });
  });

  // ------------------------------------------------------------------ packs
  describe("fotos de packs de rescate", () => {
    const pack = (imageUrl?: string) => ({ title: `${tag} pack`, originalPrice: 6, rescuePrice: 2, quantityTotal: 3, pickupStart: "19:00", pickupEnd: "20:30", ...(imageUrl ? { imageUrl } : {}) });
    it("acepta una imagen propia de la carpeta de packs y rechaza otras", async () => {
      const { owner, bizId } = await mkBusinessOwner(); const other = await mkBusinessOwner();
      const c = callerFor(owner);
      const own = ownUrl(packFolder(bizId));
      const { id } = await c.business.createRescuePack(pack(own)); created.packs.push(id);
      expect((await db.select().from(S.rescuePacks).where(eq(S.rescuePacks.id, id)))[0].imageUrl).toBe(own);
      for (const url of ["https://evil.example/x.png", ownUrl(productFolder(bizId)), ownUrl(packFolder(other.bizId)), "data:image/png;base64,AAAA"]) {
        expect((await failure(c.business.createRescuePack(pack(url)))).code, url).toBe("BAD_REQUEST");
      }
    });
  });

  // ------------------------------------------------------------------ foto del repartidor
  describe("foto del repartidor", () => {
    it("pedir la subida exige modo repartidor, tamaño válido y usa su carpeta", async () => {
      const courier = await mkUser("courier");
      const r = await callerFor(courier).profile.createCourierPhotoUpload({ contentType: "image/webp", size: 80_000 });
      expect(r.imageUrl.startsWith(`${PUBLIC}/staging/${courierFolder(courier.id)}/`)).toBe(true);
      expect(new URL(r.uploadUrl).searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
      expect((await failure(callerFor(courier).profile.createCourierPhotoUpload({ contentType: "image/webp", size: 3 * 1024 * 1024 }))).code).toBe("BAD_REQUEST");
      expect((await failure(callerFor(await mkUser("customer")).profile.createCourierPhotoUpload({ contentType: "image/webp", size: 1000 }))).code).toBe("FORBIDDEN");
    });
    it("guarda su propia foto y rechaza la de otro repartidor, la de un local y las de terceros", async () => {
      const courier = await mkUser("courier"); const other = await mkUser("courier"); const biz = await mkBusinessOwner();
      const c = callerFor(courier);
      const own = ownUrl(courierFolder(courier.id), "webp");
      expect((await c.profile.updateCourierProfile({ photoUrl: own, vehicle: "Moto", plate: "ABC-123" })).ok).toBe(true);
      expect((await db.select().from(S.users).where(eq(S.users.id, courier.id)))[0].courierPhotoUrl).toBe(own);
      for (const url of [ownUrl(courierFolder(other.id), "webp"), ownUrl(productFolder(biz.bizId)), "https://evil.example/foto.png"]) {
        expect((await failure(c.profile.updateCourierProfile({ photoUrl: url }))).code, url).toBe("BAD_REQUEST");
      }
    });
    it("al cambiar la foto se borra la anterior; si no cambia, no se borra nada", async () => {
      const courier = await mkUser("courier"); const c = callerFor(courier);
      const a = ownUrl(courierFolder(courier.id), "webp"); const b = ownUrl(courierFolder(courier.id), "webp");
      await c.profile.updateCourierProfile({ photoUrl: a, vehicle: "Moto", plate: "ABC-123" });
      await c.profile.updateCourierProfile({ photoUrl: a, bio: "Hola" });
      expect(deletes()).toEqual([]);
      await c.profile.updateCourierProfile({ photoUrl: b });
      expect(deletes()).toEqual([`/test-bucket/${keyOf(a)}`]);
    });
    it("editar otros datos sin enviar foto no toca la foto guardada", async () => {
      const courier = await mkUser("courier"); const c = callerFor(courier);
      const a = ownUrl(courierFolder(courier.id), "webp");
      await c.profile.updateCourierProfile({ photoUrl: a });
      await c.profile.updateCourierProfile({ bio: "Solo cambio mi presentación" });
      expect((await db.select().from(S.users).where(eq(S.users.id, courier.id)))[0].courierPhotoUrl).toBe(a);
      expect(deletes()).toEqual([]);
    });
  });
});
