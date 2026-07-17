import { promises as fs } from "node:fs";
import { join } from "node:path";
import { git } from "./git.ts";
import { normalizeRemoteUrl } from "./identity.ts";
import { overlayRoot } from "./paths.ts";

export interface RepoContext {
  root: string;
  remoteUrl: string;
  identity: string;
  entryDir: string;
  hasEntry: boolean;
}

export type ContextResult =
  | { ok: true; ctx: RepoContext }
  | { ok: false; fatal: boolean; reason: string };

export async function resolveContext(cwd: string): Promise<ContextResult> {
  const root = git(["rev-parse", "--show-toplevel"], cwd);
  if (root.status !== 0) {
    return { ok: false, fatal: true, reason: `not a git repository: ${cwd}` };
  }

  // `git config` (not `git remote get-url`) so url.<x>.insteadOf rewrites do
  // not leak the transport URL into the identity.
  const url = git(["config", "--get", "remote.origin.url"], root.stdout);
  if (url.status !== 0 || url.stdout === "") {
    return { ok: false, fatal: false, reason: "no `origin` remote; nothing to do" };
  }

  const identity = normalizeRemoteUrl(url.stdout);
  if (identity === null) {
    return {
      ok: false,
      fatal: false,
      reason: `remote URL has no host (${url.stdout}); nothing to do`,
    };
  }

  const entryDir = join(overlayRoot(), identity);
  let hasEntry = false;
  try {
    hasEntry = (await fs.stat(entryDir)).isDirectory();
  } catch {
    hasEntry = false;
  }

  return {
    ok: true,
    ctx: { root: root.stdout, remoteUrl: url.stdout, identity, entryDir, hasEntry },
  };
}

export async function collectEntryFiles(entryDir: string): Promise<string[]> {
  const entries = await fs.readdir(entryDir, { withFileTypes: true, recursive: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ?? (e as { path?: string }).path ?? entryDir;
    const abs = join(parent, e.name);
    const rel = abs.slice(entryDir.length + 1);
    // the overlay root may itself be a git repo; its metadata is not overlay content
    if (rel.split("/").includes(".git")) continue;
    out.push(rel);
  }
  return out.sort();
}
