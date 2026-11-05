import type { Express, NextFunction, Request, Response } from "express";
import { messages } from "../messages.js";
import type { SessionManager } from "../sessions/session-manager.js";
import {
  AccountNotFoundError,
  InvalidArgumentError,
  SessionInvalidError,
  SessionPendingError,
  parseLabel,
} from "../types.js";

const FORBIDDEN_FIELDS = new Set([
  "password",
  "pass",
  "passwd",
  "username",
  "user",
  "email",
  "cookie",
  "cookies",
  "storagestate",
  "storage_state",
]);

export function registerRoutes(app: Express, sessions: SessionManager): void {
  app.get("/api/health", wrap(async (_req, res) => {
    res.json({ ok: true });
  }));

  app.get("/api/accounts", wrap(async (_req, res) => {
    res.json({ accounts: await sessions.listAccounts() });
  }));

  app.get("/api/accounts/:id", wrap(async (req, res) => {
    res.json({ account: await sessions.getAccount(paramId(req)) });
  }));

  app.post("/api/accounts", wrap(async (req, res) => {
    rejectCredentials(req.body);
    const label = parseLabel(isRecord(req.body) ? req.body.label : undefined);
    const account = await sessions.addAccount(label);
    res.status(201).json({ account });
  }));

  app.post("/api/accounts/:id/login", wrap(async (req, res) => {
    const account = await sessions.beginInteractiveLogin(paramId(req));
    res.status(202).json({ account });
  }));

  app.post("/api/accounts/:id/probe", wrap(async (req, res) => {
    const account = await sessions.probe(paramId(req));
    res.json({ account });
  }));

  app.post("/api/accounts/:id/requests", wrap(async (req, res) => {
    rejectCredentials(req.body);
    if (!isRecord(req.body) || typeof req.body.url !== "string") {
      throw new InvalidArgumentError(messages.invalidUrl);
    }
    if (req.body.method !== undefined && req.body.method !== "GET") {
      throw new InvalidArgumentError(messages.methodRejected);
    }
    const result = await sessions.sessionFetch(paramId(req), req.body.url);
    const account = await sessions.getAccount(paramId(req));
    res.json({ ...result, account });
  }));

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    void handleError(sessions, error, req, res).catch(next);
  });
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

async function handleError(
  sessions: SessionManager,
  error: unknown,
  req: Request,
  res: Response,
): Promise<void> {
  if (res.headersSent) return;
  if (error instanceof SessionPendingError || error instanceof SessionInvalidError) {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const account = id ? await sessions.getAccount(id).catch(() => undefined) : undefined;
    res.status(409).json({ error: error.message, account });
    return;
  }
  if (error instanceof AccountNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof InvalidArgumentError) {
    res.status(400).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : messages.internal;
  if (
    message === messages.inconclusive ||
    message === messages.browserMissing ||
    message.includes("DISPLAY")
  ) {
    res.status(503).json({ error: message });
    return;
  }
  console.error("[fanlink]", error instanceof Error ? error.message : error);
  res.status(500).json({ error: messages.internal });
}

function paramId(req: Request): string {
  const value = req.params.id;
  if (typeof value !== "string") throw new AccountNotFoundError("");
  return value;
}

function rejectCredentials(body: unknown): void {
  if (!isRecord(body)) return;
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) {
      throw new InvalidArgumentError(messages.credentialsRejected);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
