import type { SpendTierId, SpendWindow } from "../spend-tiers.ts";

export const SIN_DATOS = "Sin datos" as const;
export type SinDatos = typeof SIN_DATOS;

export const TEXT_MARKS = ["bold", "italic", "underline", "strike"] as const;
export type TextMark = (typeof TEXT_MARKS)[number];

export type TextRun = {
  text: string;
  marks?: TextMark[];
};

export type MassPriceCents = number | null;

export type MassMedia = {
  vaultId: string;
  preview: boolean;
};

export type MassSubscription = "activa" | "caducada";

export type MassSegment = {
  includeAll?: boolean;
  ofListIds?: string[];
  includeFanKeys?: string[];
  spendTiers?: SpendTierId[];
  spendWindow?: SpendWindow;
  activeWithinDays?: number;
  purchasedWithinDays?: number;
  subscription?: MassSubscription;
  excludeFanKeys?: string[];
  excludeOfListIds?: string[];
};

export type MassFan = {
  fanKey: string;
  name: string | null;
  handle: string | null;
  status: "active" | "expired" | null;
  spentCents: number | null;
  spend30Cents: number | null;
  lastActiveAt: string | null;
  lastPurchaseAt: string | null;
};

export type MassHistoryMessage = {
  fanKey: string | null;
  fromFan: boolean;
  sentAt: string;
  priceCents: number | null;
  purchased: boolean | null;
};

/** Quién recibió o compró un medio concreto. Null en el snapshot: el sync no lo trae. */
export type ContentEvent = {
  fanKey: string;
  vaultId: string;
  kind: "recibido" | "comprado";
};

export type OfList = {
  id: string;
  name: string;
  fanKeys: string[];
};

export type MassSnapshot = {
  accountId: string;
  fans: MassFan[] | null;
  messages: MassHistoryMessage[] | null;
  ofLists: OfList[] | null;
  contentEvents: ContentEvent[] | null;
  /** Ids de la bóveda que el CRM conoce. Null si esa lista no se ha cargado. */
  vaultIds: string[] | null;
  sendUsage: { sentLastHour: number; sentLastDay: number } | null;
};

export type MassFollowUp = {
  body: TextRun[];
  afterHours: number;
};

export type MassDraft = {
  id: string;
  accountId: string;
  name: string;
  body: TextRun[];
  media: MassMedia[];
  /** Null es gratis. Un PPV es un entero de dólares entre 3 y 200, en céntimos. */
  priceCents: MassPriceCents;
  scheduledAt: string | null;
  segment: MassSegment;
  unsendAfterHours: number | null;
  followUp: MassFollowUp | null;
  createdBy: { id: string; name: string } | null;
  rotate: boolean;
  excludeBought: boolean;
  status: "draft" | "scheduled" | "held";
  flag?: string;
};

export type Metric = number | SinDatos;

export function textoMetrica(value: Metric | string): string {
  return value === SIN_DATOS ? SIN_DATOS : String(value);
}
