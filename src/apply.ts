import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
