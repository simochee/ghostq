export function normalizeRemoteUrl(url: string): string | null {
  let rest = url.trim();
  if (rest === "") return null;

  const scheme = rest.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    if (scheme[1]!.toLowerCase() === "file") return null;
    rest = rest.slice(scheme[0].length);
  } else {
    const scpLike = rest.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
    if (!scpLike) return null;
    rest = `${scpLike[1]}/${scpLike[2]}`;
  }

  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  let host = rest.slice(0, slash);
  const path = rest.slice(slash + 1);

  const at = host.lastIndexOf("@");
  if (at !== -1) host = host.slice(at + 1);
  host = host.replace(/:\d+$/, "");
  if (host === "") return null;

  const segments = path
    .replace(/\.git$/, "")
    .split("/")
    .filter((s) => s !== "");
  if (segments.length === 0) return null;
  // A crafted remote URL must not escape the overlay root.
  if (segments.some((s) => s === "." || s === "..")) return null;

  return [host, ...segments].join("/");
}
