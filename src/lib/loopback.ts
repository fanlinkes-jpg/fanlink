/** Hostname sin puerto. Acepta localhost y las direcciones de loopback. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.trim().toLowerCase().replace(/:\d+$/, "");
  const name = bare.startsWith("[") && bare.endsWith("]") ? bare.slice(1, -1) : bare;
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
