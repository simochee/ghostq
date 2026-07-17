import { promises as fs } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { collectEntryFiles, type RepoContext } from "./context.ts";
import { git } from "./git.ts";

export type FileState =
  | "linked"
  | "missing"
  // not merged into "conflict": a link into our own overlay entry is
  // ghostq's to repoint, while a conflict is user data and must not be touched
  | "drift"
  | "conflict"
  | "not-ignored";

export interface FileReport {
  rel: string;
  state: FileState;
}

export async function inspectFiles(ctx: RepoContext): Promise<FileReport[]> {
  const rels = await collectEntryFiles(ctx.entryDir);
  const reports: FileReport[] = [];
  for (const rel of rels) {
    reports.push({ rel, state: await inspectOne(ctx, rel) });
  }
  return reports;
}

async function inspectOne(ctx: RepoContext, rel: string): Promise<FileState> {
  const ignored = git(["check-ignore", "-q", "--", rel], ctx.root);
  if (ignored.status !== 0) return "not-ignored";

  const src = join(ctx.entryDir, rel);
  const dst = join(ctx.root, rel);

  let st;
  try {
    st = await fs.lstat(dst);
  } catch {
    return "missing";
  }
  if (!st.isSymbolicLink()) return "conflict";

  const target = resolve(dirname(dst), await fs.readlink(dst));
  if (target === resolve(src)) return "linked";
  if (target.startsWith(resolve(ctx.entryDir) + "/")) return "drift";
  return "conflict";
}

export interface ApplyReport {
  linked: string[];
  relinked: string[];
  alreadyLinked: string[];
  conflicts: string[];
  notIgnored: string[];
}

export async function applyFiles(ctx: RepoContext): Promise<ApplyReport> {
  const report: ApplyReport = {
    linked: [],
    relinked: [],
    alreadyLinked: [],
    conflicts: [],
    notIgnored: [],
  };

  for (const { rel, state } of await inspectFiles(ctx)) {
    const src = join(ctx.entryDir, rel);
    const dst = join(ctx.root, rel);
    switch (state) {
      case "linked":
        report.alreadyLinked.push(rel);
        break;
      case "missing":
        await fs.mkdir(dirname(dst), { recursive: true });
        await fs.symlink(src, dst);
        report.linked.push(rel);
        break;
      case "drift":
        await fs.unlink(dst);
        await fs.symlink(src, dst);
        report.relinked.push(rel);
        break;
      case "conflict":
        report.conflicts.push(rel);
        break;
      case "not-ignored":
        report.notIgnored.push(rel);
        break;
    }
  }
  return report;
}

export interface PruneReport {
  pruned: string[];
  removedDirs: string[];
}

export async function pruneFiles(ctx: RepoContext): Promise<PruneReport> {
  const report: PruneReport = { pruned: [], removedDirs: [] };
  const candidates = await findDanglingLinks(ctx);

  for (const dst of candidates) {
    const rel = relative(ctx.root, dst);
    // a committed symlink into the overlay entry is not ghostq's doing (apply
    // never links a non-ignored path); leave it for the user to sort out
    const ignored = git(["check-ignore", "-q", "--", rel], ctx.root);
    if (ignored.status !== 0) continue;

    await fs.unlink(dst);
    report.pruned.push(rel);
    await removeEmptyAncestors(dirname(dst), ctx.root, report.removedDirs);
  }
  return report;
}

// The overlay file behind a dangling link is, by definition, already gone —
// collectEntryFiles (which walks the overlay entry) cannot find it. The
// checkout tree is the only remaining source of truth, so we walk it
// directly instead of the entry dir.
async function findDanglingLinks(ctx: RepoContext): Promise<string[]> {
  const entryPrefix = resolve(ctx.entryDir) + "/";
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git") continue;
      const abs = join(dir, e.name);
      if (e.isSymbolicLink()) {
        if (await isDanglingGhostqLink(abs, entryPrefix)) out.push(abs);
        continue;
      }
      if (e.isDirectory()) await walk(abs);
    }
  }

  await walk(ctx.root);
  return out;
}

async function isDanglingGhostqLink(abs: string, entryPrefix: string): Promise<boolean> {
  let target: string;
  try {
    target = resolve(dirname(abs), await fs.readlink(abs));
  } catch {
    return false;
  }
  if (!target.startsWith(entryPrefix)) return false;

  try {
    await fs.stat(abs);
    return false; // target resolves; a live overlay link, not prune's job
  } catch {
    // fall through: target is missing, i.e. dangling
  }

  return true;
}

async function removeEmptyAncestors(dir: string, root: string, removed: string[]): Promise<void> {
  const rootResolved = resolve(root);
  let current = resolve(dir);
  while (current !== rootResolved && current.startsWith(rootResolved + "/")) {
    let entries;
    try {
      entries = await fs.readdir(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    await fs.rmdir(current);
    removed.push(relative(root, current));
    current = dirname(current);
  }
}
