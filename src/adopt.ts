import { promises as fs } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { resolveContext } from "./context.ts";
import { git } from "./git.ts";

export type AdoptOutcome =
  | "adopted"
  | "already-adopted"
  | "skipped-not-ignored"
  | "skipped-conflict"
  | "skipped-directory"
  | "error";

export interface AdoptReport {
  path: string;
  outcome: AdoptOutcome;
  detail?: string;
}

export async function adoptFiles(paths: string[], cwd: string): Promise<AdoptReport[]> {
  const reports: AdoptReport[] = [];
  for (const path of paths) {
    reports.push(await adoptOne(path, cwd));
  }
  return reports;
}

async function adoptOne(path: string, cwd: string): Promise<AdoptReport> {
  const requested = resolve(cwd, path);

  let st;
  try {
    st = await fs.lstat(requested);
  } catch {
    return { path, outcome: "error", detail: `no such file: ${requested}` };
  }
  // Directories hold committed files next to overlay links (symlink-each);
  // adopting one wholesale would either skip its committed siblings or
  // require a recursive walk that duplicates apply's own traversal. Reject
  // and let the caller pass the individual gitignored files instead.
  if (st.isDirectory()) {
    return { path, outcome: "skipped-directory", detail: "pass individual files, not a directory" };
  }

  // ctx.root comes from `git rev-parse --show-toplevel`, which resolves
  // symlinks in the path; resolve the parent dir the same way so `relative()`
  // below does not produce a bogus `../..` path when cwd is reached through
  // a symlinked ancestor (e.g. macOS's /tmp -> /private/tmp).
  const parent = await fs.realpath(dirname(requested));
  const abs = join(parent, requested.slice(dirname(requested).length + 1));

  const res = await resolveContext(parent);
  if (!res.ok) {
    return { path, outcome: "error", detail: res.reason };
  }
  const { ctx } = res;

  const rel = relative(ctx.root, abs);
  const overlayPath = join(ctx.entryDir, rel);

  const ignored = git(["check-ignore", "-q", "--", rel], ctx.root);
  if (ignored.status !== 0) {
    return { path, outcome: "skipped-not-ignored", detail: "not gitignored in this repo (add it to .gitignore)" };
  }

  if (st.isSymbolicLink()) {
    const target = resolve(dirname(abs), await fs.readlink(abs));
    if (target === resolve(overlayPath)) {
      return { path, outcome: "already-adopted" };
    }
    return { path, outcome: "skipped-conflict", detail: "already a symlink pointing elsewhere; will not clobber" };
  }

  let overlayExists = true;
  try {
    await fs.lstat(overlayPath);
  } catch {
    overlayExists = false;
  }
  if (overlayExists) {
    return { path, outcome: "skipped-conflict", detail: `overlay already has a file at ${overlayPath}` };
  }

  await fs.mkdir(dirname(overlayPath), { recursive: true });
  await moveFile(abs, overlayPath);
  await fs.symlink(overlayPath, abs);

  return { path, outcome: "adopted", detail: rel };
}

async function moveFile(src: string, dst: string): Promise<void> {
  try {
    await fs.rename(src, dst);
  } catch (err) {
    // EXDEV: overlay root lives on a different filesystem than the
    // checkout (e.g. overlay on a separate volume); rename cannot cross
    // devices, so fall back to copy+unlink.
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.copyFile(src, dst);
    await fs.unlink(src);
  }
}
