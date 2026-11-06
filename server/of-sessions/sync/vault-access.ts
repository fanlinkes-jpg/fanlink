export function canReadVault(access: { localOpen: boolean; role: "owner" | "member" | null; perms: readonly string[] }): boolean {
  if (access.localOpen || access.role === "owner") return true;
  return access.perms.includes("vault") || access.perms.includes("mensajes");
}
