import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), `${prefix}-`));
}

export function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function runGit(args: string[], cwd: string, env?: Record<string, string | undefined>) {
  const r = run("git", args, { cwd, env });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  }
  return r.stdout.trim();
}

export async function makeRepo(
  dir: string,
  files: Record<string, string>,
  opts: { remote?: string } = {},
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  runGit(["init", "-q", "-b", "main"], dir);
  runGit(["config", "user.email", "test@example.com"], dir);
  runGit(["config", "user.name", "test"], dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await fs.mkdir(join(abs, ".."), { recursive: true });
    await fs.writeFile(abs, content);
  }
  runGit(["add", "-A"], dir);
  runGit(["commit", "-q", "-m", "initial"], dir);
  if (opts.remote) runGit(["remote", "add", "origin", opts.remote], dir);
  return dir;
}

export async function writeOverlayEntry(
  overlayRoot: string,
  identity: string,
  files: Record<string, string>,
): Promise<string> {
  const entry = join(overlayRoot, identity);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(entry, rel);
    await fs.mkdir(join(abs, ".."), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return entry;
}
