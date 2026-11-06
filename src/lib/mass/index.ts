export { SPEND_TIERS, spendTone } from "../spend-tiers.ts";
export {
  FAN_WHALE_CENTS,
  defaultSpendCuts,
  isMassSpendTier,
  isWhale,
  matchesSpendTier,
  spendAmount,
  spendBand,
} from "./spend.ts";
export type { MassSpendTier, SpendCut, SpendWindow } from "./spend.ts";
export { SIN_DATOS, textoMetrica } from "./types.ts";
export type {
  ContentEvent,
  MassDraft,
  MassFan,
  MassHistoryMessage,
  MassMedia,
  MassSegment,
  MassSnapshot,
  Metric,
  OfList,
  SinDatos,
  TextMark,
  TextRun,
} from "./types.ts";
export { formattedText, parseMarkup, personalize, plainText } from "./text.ts";
export {
  LAUNCH_TOKEN_TTL_MS,
  MASS_PERMISSION,
  beginMassLaunch,
  canCreateMass,
  canLaunchMass,
  confirmMassLaunch,
} from "./access.ts";
export { hashLaunchToken, tokenHashEquals } from "./access.ts";
export type { MassActor } from "./access.ts";
export {
  MASS_ALLOW_ACCOUNTS,
  MASS_SEND_FLAG,
  SEND_FLAG,
  massAllowAccounts,
  massSendEnabled,
  massSendGate,
} from "./gates.ts";
export type { MassEnv, MassGate } from "./gates.ts";
export {
  composeMass,
  hasAudience,
  PPV_MAX_CENTS,
  PPV_MIN_CENTS,
} from "./composer.ts";
export type { ComposeMassInput, ComposeMassResult } from "./composer.ts";
export { resolveSegment } from "./segments.ts";
export type { SegmentResolution } from "./segments.ts";
export { bestSendHour, suggestPrice } from "./smart.ts";
export {
  followUpRecipients,
  massStats,
  massStatsForRole,
  textoIngresos,
} from "./stats.ts";
export type { MassDelivery, MassStats, VisibleMassStats } from "./stats.ts";
export { canTransitionMass } from "./status.ts";
export { MASS_STATUSES } from "./types.ts";
export type { MassStatus } from "./types.ts";
export { DEFAULT_PACE, buildQueue, gapMs, validPace } from "./queue.ts";
export type { PaceLimits, QueuePlan } from "./queue.ts";
export { dryRunMass } from "./dry-run.ts";
export type { DryRunResult } from "./dry-run.ts";
export { snapshotFromSynced } from "./from-synced.ts";
export type {
  SyncedFanRow,
  SyncedMessageRow,
  SyncedPurchaseRow,
} from "./from-synced.ts";
