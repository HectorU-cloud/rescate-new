import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { compressToWebp, putToSignedUrl } from "@/lib/image-upload";
import { MIN_PAYMENT_REFERENCE_LENGTH } from "@contracts/wallet";

const field = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-semibold";

/**
 * Reporte de pago de repartidores y comercios: importe, referencia y foto del comprobante.
 * El pago queda "por verificar" y no reduce el saldo hasta que administración lo confirme.
 */
export default function PaymentReportForm({ balance, disabledReason }: { balance: number; disabledReason?: string }) {
  const utils = trpc.useUtils();
  const createUpload = trpc.wallet.createProofUpload.useMutation();
  const report = trpc.wallet.reportPayment.useMutation({
    onSuccess: () => {
      toast.success("Pago reportado. Administración lo verificará pronto.");
      setReference(""); setNote(""); clearProof();
      utils.wallet.mine.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const clearProof = () => { setProofUrl(""); setPreview(""); };

  const pickFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressToWebp(file);
      const signed = await createUpload.mutateAsync({ contentType: "image/webp", size: blob.size });
      await putToSignedUrl(signed.uploadUrl, blob);
      setPreview(URL.createObjectURL(blob));
      setProofUrl(signed.imageUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo subir la foto.");
    } finally {
      setBusy(false);
    }
  };

  const parsed = Number(amount);
  const ready = Number.isFinite(parsed) && parsed > 0 && reference.trim().length >= MIN_PAYMENT_REFERENCE_LENGTH && !!proofUrl && !busy && !report.isPending;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} disabled={!!disabledReason} className="mt-3 w-full rounded-xl bg-foreground py-2.5 text-sm font-extrabold text-white disabled:opacity-50">
        💵 {disabledReason ?? "Reportar un pago"}
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2.5 rounded-2xl bg-secondary/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Reportar un pago</p>
        <button onClick={() => setOpen(false)} className="text-xs font-bold text-muted-foreground underline">Cerrar</button>
      </div>
      <label className="block text-xs font-bold">Importe pagado ($)
        <input className={`${field} mt-1`} inputMode="decimal" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="block text-xs font-bold">Referencia o n.º de transferencia
        <input className={`${field} mt-1`} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} placeholder="Ej. 123456789" />
      </label>
      <label className="block text-xs font-bold">Comentario (opcional)
        <input className={`${field} mt-1`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="text-xs font-bold">
        Foto del comprobante
        <div className="mt-1 flex items-center gap-3">
          <label className="cursor-pointer rounded-xl bg-card px-3 py-2 text-xs font-extrabold ring-1 ring-border">
            {busy ? "Subiendo…" : proofUrl ? "Cambiar foto" : "Subir foto"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(e) => { void pickFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
          </label>
          {preview && <img src={preview} alt="Comprobante" className="h-14 w-14 rounded-lg object-cover ring-1 ring-border" />}
        </div>
      </div>
      <button
        disabled={!ready}
        onClick={() => report.mutate({ amount: parsed, paymentReference: reference.trim(), proofUrl, ...(note.trim() ? { note: note.trim() } : {}) })}
        className="w-full rounded-xl bg-brand py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
      >
        {report.isPending ? "Enviando…" : "Enviar pago para verificar"}
      </button>
    </div>
  );
}
