import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listRealCampaigns, previewRealCampaign, saveRealCampaign, campaignSendFlag, type CampaignDraftView } from "@/lib/of-campaigns";
import { useCrm } from "@/lib/crm";
import { Button, Field, Panel, Select } from "@/components/ui";

const SEGMENTS = [
  { id: "active", label: "Activos" },
  { id: "expired", label: "Expirados" },
  { id: "spent", label: "Con gasto" },
  { id: "quiet", label: "Sin interacción reciente" },
  { id: "whale", label: "Ballena" },
  { id: "risk", label: "En riesgo" },
  { id: "asleep", label: "Dormido" },
  { id: "new", label: "Nuevo" },
] as const;

function formatRatio(value: number | null): string {
  if (value == null) return "Sin datos";
  return `${Math.round(value * 100)}%`;
}

export function CampaignDrafts() {
  const creators = useCrm((s) => s.creators);
  const vault = useCrm((s) => s.vault);
  const [creatorId, setCreatorId] = useState(creators[0]?.id ?? "");
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]["id"]>("active");
  const [body, setBody] = useState("Hola {nombre}");
  const [price, setPrice] = useState("");
  const [quietDays, setQuietDays] = useState("30");
  const [minSpent, setMinSpent] = useState("10");
  const [when, setWhen] = useState("");
  const [vaultIds, setVaultIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ count: number; samples: string[] } | null>(null);
  const [drafts, setDrafts] = useState<CampaignDraftView[]>([]);
  const [sendEnabled, setSendEnabled] = useState(false);

  useEffect(() => {
    void listRealCampaigns().then(setDrafts).catch(() => setDrafts([]));
    void campaignSendFlag().then((flag) => setSendEnabled(flag.sendEnabled)).catch(() => setSendEnabled(false));
  }, []);

  const media = vault.filter((item) => item.creatorId === creatorId);

  async function estimate() {
    const result = await previewRealCampaign({
      data: {
        creatorId,
        segment,
        body,
        minSpentCents: Math.round(Number(minSpent) * 100) || 0,
        quietDays: Number(quietDays) || 30,
      },
    });
    setPreview(result);
  }

  return (
    <Panel title="Borrador con fans sincronizados">
      <p className="mb-3 text-sm text-muted">El segmento sale de los fans leídos de OnlyFans. Guardar no envía.</p>
      <form
        className="grid gap-2 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void saveRealCampaign({
            data: {
              creatorId,
              name,
              segment,
              body,
              priceCents: price.trim() ? Math.round(Number(price) * 100) : null,
              vaultIds,
              scheduledAt: when ? new Date(when).toISOString() : null,
              minSpentCents: Math.round(Number(minSpent) * 100) || 0,
              quietDays: Number(quietDays) || 30,
            },
          })
            .then(async (draft) => {
              setDrafts(await listRealCampaigns());
              toast.success(`Borrador guardado · ${draft.recipientCount} destinatarios`);
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "No se ha podido guardar"));
        }}
      >
        <Select value={creatorId} onChange={(event) => setCreatorId(event.target.value)} aria-label="Creadora">
          {creators.map((creator) => (
            <option key={creator.id} value={creator.id}>{creator.name}</option>
          ))}
        </Select>
        <Select value={segment} onChange={(event) => setSegment(event.target.value as typeof segment)} aria-label="Segmento">
          {SEGMENTS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </Select>
        <Field value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre" required />
        <Field value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Precio PPV" inputMode="decimal" />
        <Field value={minSpent} onChange={(event) => setMinSpent(event.target.value)} placeholder="Gasto mínimo" inputMode="decimal" />
        <Field value={quietDays} onChange={(event) => setQuietDays(event.target.value)} placeholder="Días sin interacción" inputMode="numeric" />
        <label className="text-xs text-muted">
          Programar
          <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-line px-2 text-sm" />
        </label>
        <label className="text-xs text-muted">
          Medios del vault
          <select multiple value={vaultIds} onChange={(event) => setVaultIds([...event.target.selectedOptions].map((option) => option.value))} className="mt-1 block h-24 w-full rounded-md border border-line text-sm">
            {media.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        </label>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} required rows={3} className="rounded-md border border-line bg-bg px-3 py-2 text-sm md:col-span-2" />
        <div className="flex gap-2 md:col-span-2">
          <Button type="button" variant="ghost" onClick={() => void estimate()}>Vista previa</Button>
          <Button type="submit">Guardar borrador</Button>
          <Button type="button" disabled={!sendEnabled} title="Envío real desactivado">
            {sendEnabled ? "Enviar" : "Envío real desactivado"}
          </Button>
        </div>
      </form>
      {preview && (
        <div className="mt-3 text-sm">
          <p>{preview.count} destinatarios estimados.</p>
          {preview.samples.map((sample) => (
            <p key={sample} className="mt-1 text-muted">{sample}</p>
          ))}
          {vaultIds.length > 0 && <p className="mt-1 text-muted">Medios: {vaultIds.join(", ")}</p>}
        </div>
      )}
      <ul className="mt-4 space-y-2 text-sm">
        {drafts.map((draft) => (
          <li key={draft.id} className="rounded-md border border-line px-3 py-2">
            <p className="font-medium">{draft.name} · {draft.recipientCount} destinatarios · {draft.status === "scheduled" ? "programada" : "borrador"}</p>
            <p className="text-muted">
              Compras: {draft.purchases == null ? "Sin datos" : draft.purchases}
              {" · "}Ingresos: {draft.revenueCents == null ? "Sin datos" : `$${(draft.revenueCents / 100).toFixed(2)}`}
              {" · "}Conversión: {formatRatio(draft.purchases == null || draft.recipientCount <= 0 ? null : draft.purchases / draft.recipientCount)}
            </p>
            <p className="text-muted">{draft.body}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
