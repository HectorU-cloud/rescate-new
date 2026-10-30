/**
 * Pruebas de integración (MySQL real + almacenamiento S3 falso en memoria): pagos reportados con comprobante,
 * revisión del admin, reportes por período y liquidaciones.
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts). Nunca usan tu R2 real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { MAX_PENDING_PAYMENTS } from "@contracts/wallet";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("pagos, comprobantes y liquidaciones (MySQL real + S3 falso)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let appRouter: (typeof import("./router"))["appRouter"];
  let fakeS3: http.Server;
  const requests: Array<{ method: string; url: string }> = [];
  const PUBLIC = "https://cdn.test.dev";

  const tag = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let seq = 0;
  const created = { users: [] as number[], businesses: [] as number[] };

  beforeAll(async () => {
    fakeS3 = http.createServer((req, res) => {
      requests.push({ method: req.method ?? "", url: req.url ?? "" });
      res.statusCode = req.method === "DELETE" ? 204 : 200;
      if (req.method === "PUT" && req.headers["x-amz-copy-source"]) {
        res.setHeader("content-type", "application/xml");
        res.end('<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>"etag"</ETag><LastModified>2026-01-01T00:00:00.000Z</LastModified></CopyObjectResult>');
        return;
      }
      res.end();
    });
    await new Promise<void>((resolve) => fakeS3.listen(0, "127.0.0.1", resolve));
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
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
    if (created.users.length) {
      await db.delete(S.settlements).where(and(eq(S.settlements.walletType, "courier"), inArray(S.settlements.walletId, created.users)));
      await db.delete(S.walletEntries).where(and(eq(S.walletEntries.walletType, "courier"), inArray(S.walletEntries.walletId, created.users)));
    }
    if (created.businesses.length) {
      await db.delete(S.settlements).where(and(eq(S.settlements.walletType, "business"), inArray(S.settlements.walletId, created.businesses)));
      await db.delete(S.walletEntries).where(and(eq(S.walletEntries.walletType, "business"), inArray(S.walletEntries.walletId, created.businesses)));
      await db.delete(S.businesses).where(inArray(S.businesses.id, created.businesses));
    }
    if (created.users.length) await db.delete(S.users).where(inArray(S.users.id, created.users));
  });

  beforeEach(() => { requests.length = 0; });

  // ------------------------------------------------------------------ ayudantes
  type User = Awaited<ReturnType<typeof mkUser>>;
  async function mkUser(kind: "customer" | "business" | "courier" | "admin") {
    const [{ id }] = await db.insert(S.users).values({
      unionId: `${tag}-u${seq++}`, name: `${tag} ${kind}`,
      ...(kind === "admin" ? { role: "admin" as const } : { appRole: kind, courierApproved: kind === "courier" }),
    }).$returningId();
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
  const entry = (walletType: "courier" | "business", walletId: number, entryType: "charge" | "payment", amount: number, extra: Partial<typeof S.walletEntries.$inferInsert> = {}) =>
    db.insert(S.walletEntries).values({ walletType, walletId, entryType, amount, status: "confirmed", description: `${tag} movimiento`, ...extra });
  const stagedProof = async (c: ReturnType<typeof callerFor>) => (await c.wallet.createProofUpload({ contentType: "image/webp", size: 5000 })).imageUrl;
  const paymentRows = (walletType: "courier" | "business", walletId: number) =>
    db.select().from(S.walletEntries).where(and(eq(S.walletEntries.walletType, walletType), eq(S.walletEntries.walletId, walletId), eq(S.walletEntries.entryType, "payment")));

  // ------------------------------------------------------------------ reportar un pago
  describe("reportar un pago con comprobante", () => {
    it("queda por verificar, el comprobante pasa de staging a su carpeta y el saldo no cambia", async () => {
      const courier = await mkUser("courier");
      await entry("courier", courier.id, "charge", 5);
      const c = callerFor(courier);
      const staged = await stagedProof(c);
      expect(staged).toContain(`/staging/payments/courier/${courier.id}/proof/`);

      await c.wallet.reportPayment({ amount: 3, paymentReference: "  TR   778899 ", proofUrl: staged });

      const [row] = await paymentRows("courier", courier.id);
      expect(row.status).toBe("pending");
      expect(row.paymentReference).toBe("TR 778899");
      expect(row.createdBy).toBe(courier.id);
      expect(row.proofUrl).toContain(`${PUBLIC}/payments/courier/${courier.id}/proof/`);
      expect(row.proofUrl).not.toContain("staging");
      expect(requests.some((r) => r.method === "PUT" && r.url.includes(`/payments/courier/${courier.id}/proof/`))).toBe(true);
      expect(requests.some((r) => r.method === "DELETE" && decodeURIComponent(r.url).includes(`/staging/payments/courier/${courier.id}/proof/`))).toBe(true);

      const mine = await c.wallet.mine();
      expect(mine!.balance).toBe(5);
      expect(mine!.pendingPayments).toBe(3);
      const mineEntry = mine!.entries.find((e) => e.entryType === "payment")!;
      expect(mineEntry.hasProof).toBe(true);
      expect(mineEntry).not.toHaveProperty("proofUrl"); // la persona no recibe la URL del comprobante
    });

    it("un comercio también puede reportar y se registra en la cuenta de su local", async () => {
      const { owner, bizId } = await mkBusinessOwner();
      const c = callerFor(owner);
      await c.wallet.reportPayment({ amount: 7.5, paymentReference: "BIZ-0001", proofUrl: await stagedProof(c) });
      const [row] = await paymentRows("business", bizId);
      expect(row).toMatchObject({ status: "pending", amount: 7.5 });
    });

    it("rechaza referencias repetidas (sin distinguir mayúsculas), comprobantes reusados y fotos ajenas", async () => {
      const a = await mkUser("courier");
      const b = await mkUser("courier");
      const ca = callerFor(a), cb = callerFor(b);
      await ca.wallet.reportPayment({ amount: 2, paymentReference: "DUP-123456", proofUrl: await stagedProof(ca) });
      const [first] = await paymentRows("courier", a.id);

      // misma referencia desde OTRA cuenta
      expect((await failure(cb.wallet.reportPayment({ amount: 2, paymentReference: "dup-123456", proofUrl: await stagedProof(cb) }))).message).toMatch(/ya fue registrada/);
      // mismo comprobante con otra referencia
      expect((await failure(ca.wallet.reportPayment({ amount: 2, paymentReference: "OTRA-9999", proofUrl: first.proofUrl! }))).message).toMatch(/comprobante ya fue usado/);
      // foto subida por otra cuenta
      const foreign = await stagedProof(cb);
      expect((await failure(ca.wallet.reportPayment({ amount: 2, paymentReference: "AJENA-777", proofUrl: foreign }))).message).toMatch(/imagen no es válida/);
      // fotos de terceros (cualquier URL)
      expect((await failure(ca.wallet.reportPayment({ amount: 2, paymentReference: "WEB-12345", proofUrl: "https://evil.example/x.jpg" }))).message).toMatch(/imagen no es válida/);
      expect(await paymentRows("courier", a.id)).toHaveLength(1);
    });

    it("valida referencia e importe, y los clientes no tienen estado de cuenta", async () => {
      const courier = await mkUser("courier");
      const c = callerFor(courier);
      const proofUrl = await stagedProof(c);
      expect((await failure(c.wallet.reportPayment({ amount: 2, paymentReference: "ab", proofUrl }))).code).toBe("BAD_REQUEST");
      expect((await failure(c.wallet.reportPayment({ amount: 0, paymentReference: "REF-0000", proofUrl }))).code).toBe("BAD_REQUEST");
      const customer = await mkUser("customer");
      const cc = callerFor(customer);
      expect((await failure(cc.wallet.createProofUpload({ contentType: "image/webp", size: 1000 }))).code).toBe("FORBIDDEN");
      expect((await failure(cc.wallet.reportPayment({ amount: 2, paymentReference: "REF-1111", proofUrl }))).code).toBe("FORBIDDEN");
    });

    it("limita cuántos pagos por verificar puede tener una cuenta", async () => {
      const courier = await mkUser("courier");
      for (let i = 0; i < MAX_PENDING_PAYMENTS; i++) await entry("courier", courier.id, "payment", 1, { status: "pending", paymentReference: `${tag}-L${i}` });
      const c = callerFor(courier);
      expect((await failure(c.wallet.reportPayment({ amount: 1, paymentReference: "LIM-99999", proofUrl: await stagedProof(c) }))).message).toMatch(/por verificar/);
    });
  });

  // ------------------------------------------------------------------ revisión del admin
  describe("revisión del admin", () => {
    it("el admin ve el comprobante, rechaza con motivo, y luego confirma un pago nuevo", async () => {
      const courier = await mkUser("courier");
      const admin = await mkUser("admin");
      await entry("courier", courier.id, "charge", 5);
      const c = callerFor(courier), a = callerFor(admin);

      await c.wallet.reportPayment({ amount: 5, paymentReference: "REV-000001", proofUrl: await stagedProof(c) });
      const pending = (await a.admin.financeEntries({ status: "pending" })).find((e) => e.walletType === "courier" && Number(e.walletId) === courier.id)!;
      expect(pending.proofUrl).toContain(`/payments/courier/${courier.id}/proof/`);
      expect(pending.walletName).toContain("courier");

      // rechazar exige un motivo
      expect((await failure(a.admin.reviewFinancePayment({ entryId: pending.id, decision: "rejected" }))).message).toMatch(/motivo/);
      await a.admin.reviewFinancePayment({ entryId: pending.id, decision: "rejected", note: "El monto no coincide con el banco" });
      let mine = await c.wallet.mine();
      expect(mine!.balance).toBe(5);
      expect(mine!.entries.find((e) => e.id === pending.id)).toMatchObject({ status: "rejected", reviewNote: "El monto no coincide con el banco" });
      // un pago ya revisado no se revisa dos veces
      expect((await failure(a.admin.reviewFinancePayment({ entryId: pending.id, decision: "confirmed" }))).message).toMatch(/ya fue revisado/);

      // la persona reporta de nuevo (el rechazado ya no cuenta como pendiente ni bloquea su referencia futura)
      await c.wallet.reportPayment({ amount: 5, paymentReference: "REV-000002", proofUrl: await stagedProof(c) });
      const second = (await a.admin.financeEntries({ status: "pending" })).find((e) => e.paymentReference === "REV-000002")!;
      await a.admin.reviewFinancePayment({ entryId: second.id, decision: "confirmed" });
      mine = await c.wallet.mine();
      expect(mine!.balance).toBe(0);
      expect(mine!.pendingPayments).toBe(0);
    });

    it("solo un admin puede revisar pagos, ver reportes o generar liquidaciones", async () => {
      const courier = await mkUser("courier");
      const c = callerFor(courier);
      expect((await failure(c.admin.reviewFinancePayment({ entryId: 1, decision: "confirmed" }))).code).toBe("FORBIDDEN");
      expect((await failure(c.admin.financeReport({ from: "2001-03-01", to: "2001-03-31" }))).code).toBe("FORBIDDEN");
      expect((await failure(c.admin.createSettlements({ from: "2001-03-01", to: "2001-03-31" }))).code).toBe("FORBIDDEN");
    });
  });

  // ------------------------------------------------------------------ reportes y liquidaciones
  describe("reportes por período y liquidaciones", () => {
    // Un período lejano: solo existen en él los movimientos que crea esta prueba.
    const P = { from: "2001-03-01", to: "2001-03-31" };

    it("el reporte separa saldo inicial, cargos, pagos y deuda, y la liquidación es idempotente", async () => {
      const courier = await mkUser("courier");
      const admin = await mkUser("admin");
      const at = (iso: string) => new Date(iso);
      await entry("courier", courier.id, "charge", 2, { createdAt: at("2001-02-10T12:00:00Z") });
      await entry("courier", courier.id, "charge", 5, { createdAt: at("2001-03-10T12:00:00Z") });
      await entry("courier", courier.id, "charge", 3, { createdAt: at("2001-03-20T12:00:00Z") });
      await entry("courier", courier.id, "payment", 4, { createdAt: at("2001-03-22T12:00:00Z"), reviewedAt: at("2001-03-25T12:00:00Z") });
      await entry("courier", courier.id, "payment", 1, { status: "pending", createdAt: at("2001-03-28T12:00:00Z") });
      const a = callerFor(admin);

      const report = await a.admin.financeReport(P);
      const row = report.rows.find((r) => r.walletType === "courier" && r.walletId === courier.id)!;
      expect(row).toMatchObject({ openingBalance: 2, charges: 8, payments: 4, adjustments: 0, closingBalance: 6, pendingPayments: 1 });
      expect(report.days).toBe(31);

      const first = await a.admin.createSettlements(P);
      expect(first.created).toBeGreaterThanOrEqual(1);
      const again = await a.admin.createSettlements(P);
      expect(again.created).toBe(0);
      expect(again.skipped).toBeGreaterThanOrEqual(1);

      const mySettlements = await callerFor(courier).wallet.mySettlements();
      expect(mySettlements).toHaveLength(1);
      expect(mySettlements[0]).toMatchObject({ openingBalance: 2, charges: 8, payments: 4, closingBalance: 6 });
      expect(new Date(mySettlements[0].periodStart).toISOString()).toBe("2001-03-01T05:00:00.000Z");
      expect(new Date(mySettlements[0].periodEnd).toISOString()).toBe("2001-04-01T05:00:00.000Z");
      const listed = (await a.admin.settlements()).find((s) => s.walletType === "courier" && s.walletId === courier.id)!;
      expect(listed.name).toContain("courier");
    });

    it("no liquida períodos sin terminar ni rangos inválidos", async () => {
      const admin = await mkUser("admin");
      const a = callerFor(admin);
      const next = new Date().getFullYear() + 1;
      expect((await failure(a.admin.createSettlements({ from: `${next}-01-01`, to: `${next}-01-31` }))).message).toMatch(/aún no termina/);
      expect((await failure(a.admin.financeReport({ from: "2001-03-31", to: "2001-03-01" }))).message).toMatch(/anterior/);
      expect((await failure(a.admin.financeReport({ from: "2001-01-01", to: "2003-01-01" }))).message).toMatch(/366/);
    });
  });
});
