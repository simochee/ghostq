#!/usr/bin/env bun
import { applyFiles, inspectFiles, type FileState } from "./apply.ts";
import { resolveContext } from "./context.ts";
import { install, uninstall } from "./install.ts";
import { overlayRoot } from "./paths.ts";

const USAGE = `ghostq — re-link personal, gitignored, per-repo files on clone / worktree add

Usage:
  ghostq install           set up the global post-checkout hook (core.hooksPath)
  ghostq apply [path]      link overlay files into the checkout (idempotent)
  ghostq status [path]     show link states and warnings without changing anything
  ghostq root              print the overlay root
  ghostq uninstall         remove the hook wiring

Overlay root: $GHOSTQ_ROOT or \${XDG_CONFIG_HOME:-~/.config}/ghostq/overlay,
laid out as <root>/<host>/<user>/<repo>/ mirroring each repo's remote URL.`;

async function apply(path: string): Promise<number> {
  const res = await resolveContext(path);
  if (!res.ok) {
    console.error(`ghostq: ${res.reason}`);
    return res.fatal ? 1 : 0;
  }
  const { ctx } = res;
  if (!ctx.hasEntry) {
    console.error(`ghostq: no overlay entry for ${ctx.identity}; nothing to do`);
    return 0;
  }

  const report = await applyFiles(ctx);
  for (const rel of report.linked) console.log(`linked   ${rel}`);
  for (const rel of report.relinked) console.log(`relinked ${rel}`);
  for (const rel of report.notIgnored) {
    console.error(`ghostq: skip ${rel}: not gitignored in this repo (add it to .gitignore)`);
  }
  for (const rel of report.conflicts) {
    console.error(`ghostq: skip ${rel}: an existing file is in the way (not a ghostq link)`);
  }
  const n = report.linked.length + report.relinked.length;
  if (n > 0) console.log(`ghostq: linked ${n} file(s) from ${ctx.identity}`);
  return 0;
}

const STATE_NOTES: Record<FileState, string> = {
  linked: "",
  missing: "run `ghostq apply`",
  drift: "symlink points at another overlay file; `ghostq apply` will fix it",
  conflict: "existing file is not a ghostq link; will not be touched",
  "not-ignored": "add it to .gitignore",
};

async function status(path: string): Promise<number> {
  const res = await resolveContext(path);
  if (!res.ok) {
    console.error(`ghostq: ${res.reason}`);
    return res.fatal ? 1 : 0;
  }
  const { ctx } = res;
  console.log(`repo:     ${ctx.root}`);
  console.log(`remote:   ${ctx.remoteUrl}`);
  console.log(`identity: ${ctx.identity}`);
  console.log(`overlay:  ${ctx.entryDir}${ctx.hasEntry ? "" : " (no entry)"}`);
  if (!ctx.hasEntry) return 0;

  const reports = await inspectFiles(ctx);
  if (reports.length === 0) {
    console.log("overlay entry is empty");
    return 0;
  }
  console.log("");
  for (const { rel, state } of reports) {
    const note = STATE_NOTES[state];
    console.log(`  ${state.padEnd(12)} ${rel}${note ? `  (${note})` : ""}`);
  }
  return 0;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "install":
      return install();
    case "uninstall":
      return uninstall();
    case "apply":
      return apply(rest[0] ?? process.cwd());
    case "status":
      return status(rest[0] ?? process.cwd());
    case "root":
      console.log(overlayRoot());
      return 0;
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(USAGE);
      return cmd === undefined ? 1 : 0;
    default:
      console.error(`ghostq: unknown command: ${cmd}`);
      console.error(USAGE);
      return 1;
  }
}

process.exit(await main());
