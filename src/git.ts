import { spawnSync } from "node:child_process";

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function git(args: string[], cwd?: string): GitResult {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: r.status ?? 1,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
  };
}
