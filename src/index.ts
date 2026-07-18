#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { type AdoptOutcome, adoptFiles } from "./adopt.ts";
import { applyFiles, type FileState, inspectFiles, pruneFiles } from "./apply.ts";
import { resolveContext } from "./context.ts";
import { install, uninstall } from "./install.ts";
import { overlayRoot } from "./paths.ts";

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

async function prune(path: string): Promise<number> {
  const res = await resolveContext(path);
  if (!res.ok) {
    console.error(`ghostq: ${res.reason}`);
    return res.fatal ? 1 : 0;
  }
  const { ctx } = res;

  const report = await pruneFiles(ctx);
  for (const rel of report.pruned) console.log(`pruned   ${rel}`);
  if (report.pruned.length > 0) console.log(`ghostq: pruned ${report.pruned.length} dangling link(s) from ${ctx.identity}`);
  return 0;
}

const ADOPT_NOTES: Record<AdoptOutcome, string> = {
  adopted: "",
  "already-adopted": "already linked into the overlay",
  "skipped-not-ignored": "not gitignored in this repo (add it to .gitignore)",
  "skipped-conflict": "",
  "skipped-directory": "pass individual files, not a directory",
  error: "",
};

async function adopt(paths: string[]): Promise<number> {
  const reports = await adoptFiles(paths, process.cwd());
  let failed = false;
  for (const { path, outcome, detail } of reports) {
    switch (outcome) {
      case "adopted":
        console.log(`adopted  ${path}${detail ? ` -> ${detail}` : ""}`);
        break;
      case "already-adopted":
        console.log(`ghostq: ${path}: ${ADOPT_NOTES[outcome]}`);
        break;
      case "error":
        console.error(`ghostq: ${path}: ${detail}`);
        failed = true;
        break;
      default: {
        const note = detail || ADOPT_NOTES[outcome];
        console.error(`ghostq: skip ${path}: ${note}`);
        break;
      }
    }
  }
  return failed ? 1 : 0;
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

const program = new Command();

program
  .name("ghostq")
  .description("re-link personal, gitignored, per-repo files on clone / worktree add")
  .version(pkg.version, "-v, --version", "print the version");

program
  .command("install")
  .description("install the post-checkout hook globally (init.templateDir)")
  .action(async () => {
    process.exit(await install());
  });

program
  .command("uninstall")
  .description("remove the hook wiring")
  .action(async () => {
    process.exit(await uninstall());
  });

program
  .command("apply")
  .description("link overlay files into the checkout (idempotent)")
  .argument("[path]", "repo path (defaults to cwd)")
  .action(async (path?: string) => {
    process.exit(await apply(path ?? process.cwd()));
  });

program
  .command("adopt")
  .description("move existing gitignored files into the overlay and link them")
  .argument("<files...>", "one or more files to adopt")
  .action(async (files: string[]) => {
    process.exit(await adopt(files));
  });

program
  .command("status")
  .description("show link states and warnings without changing anything")
  .argument("[path]", "repo path (defaults to cwd)")
  .action(async (path?: string) => {
    process.exit(await status(path ?? process.cwd()));
  });

program
  .command("prune")
  .description("remove dangling ghostq-managed links (idempotent)")
  .argument("[path]", "repo path (defaults to cwd)")
  .action(async (path?: string) => {
    process.exit(await prune(path ?? process.cwd()));
  });

program
  .command("root")
  .description("print the overlay root")
  .action(() => {
    console.log(overlayRoot());
  });

await program.parseAsync();
