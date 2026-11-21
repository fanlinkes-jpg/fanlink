import { redirect } from "@tanstack/react-router";
import { legacyRedirect } from "./nav-config.ts";

export function legacyRedirectThrow(pathname: string, search: Record<string, unknown> = {}): never {
  const target = legacyRedirect(pathname, search);
  if (!target) {
    throw new Error(`Sin redirección para ${pathname}`);
  }
  throw redirect(target);
}
