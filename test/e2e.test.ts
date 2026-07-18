import { afterAll, describe, expect, test } from "bun:test";
import { promises as fs, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRepo, run, runGit, writeOverlayEntry } from "./helpers.ts";

const projectRoot = join(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "ghostq-e2e-"));
const bin = join(tmp, "bin", "ghostq");
const home = join(tmp, "home");
const xdg = join(home, ".config");
const gitConfigGlobal = join(home, ".gitconfig");
const templateDir = join(xdg, "ghostq", "template");
const shimPath = join(templateDir, "hooks", "post-checkout");
const overlayRoot = join(xdg, "ghostq", "overlay");
const prevTemplate = join(tmp, "prev-template");
const upstream = join(tmp, "upstream");
const REMOTE = "https://github.com/testuser/testrepo.git";
const clone1 = join(tmp, "clone1");

const ENV = {
  HOME: home,
  XDG_CONFIG_HOME: xdg,
  GIT_CONFIG_GLOBAL: gitConfigGlobal,
  GIT_CONFIG_NOSYSTEM: "1",
  GHOSTQ_ROOT: undefined,
};

{
  const build = run("bun", ["build", "--compile", "./src/index.ts", "--outfile", bin], {
    cwd: projectRoot,
  });
  if (build.status !== 0) throw new Error(`bun build failed: ${build.stderr}`);
}

function ghostq(args: string[], cwd?: string) {
  return run(bin, args, { cwd, env: ENV });
}

function gitConfig(key: string): string {
  return run("git", ["config", "--global", "--get", key], { env: ENV }).stdout.trim();
}

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("ghostq end-to-end", () => {
  test("setup: upstream repo, overlay entry, and a pre-existing init.templateDir", async () => {
    await fs.mkdir(home, { recursive: true });
    for (const [k, v] of Object.entries({
      "user.email": "test@example.com",
      "user.name": "test",
      "init.defaultBranch": "main",
      // clone the GitHub-shaped URL from a local directory while
      // remote.origin.url keeps the GitHub-shaped value
      [`url.${upstream}.insteadOf`]: REMOTE,
    })) {
      run("git", ["config", "--global", k, v], { env: ENV });
    }

    await makeRepo(upstream, {
      ".gitignore": ".env.local\n.claude/personal.md\n",
      ".claude/settings.json": '{ "committed": true }\n',
      "README.md": "hello\n",
    });

    await writeOverlayEntry(overlayRoot, "github.com/testuser/testrepo", {
      ".claude/personal.md": "my notes\n",
      ".env.local": "SECRET=1\n",
    });

    // a template that predates ghostq install: its info/exclude must survive
    // the override, and its post-checkout must keep firing (chained)
    await fs.mkdir(join(prevTemplate, "info"), { recursive: true });
    await fs.mkdir(join(prevTemplate, "hooks"), { recursive: true });
    await fs.writeFile(join(prevTemplate, "info", "exclude"), "# custom-prev-template\n");
    await fs.writeFile(
      join(prevTemplate, "hooks", "post-checkout"),
      `#!/bin/sh\ntouch prev-template-hook-ran\n`,
      { mode: 0o755 },
    );
    run("git", ["config", "--global", "init.templateDir", prevTemplate], { env: ENV });
  });

  test("install sets init.templateDir, records the previous one, never touches core.hooksPath", async () => {
    const r = ghostq(["install"]);
    expect(r.status).toBe(0);
    expect(gitConfig("init.templateDir")).toBe(templateDir);
    // ghostq must stay out of the hooks path so lefthook/husky/... coexist
    expect(gitConfig("core.hooksPath")).toBe("");
    const shim = await fs.readFile(shimPath, "utf8");
    expect(shim.startsWith("#!/bin/sh")).toBe(true);
  });

  test("install seeds the previous template and preserves its post-checkout as .ghostq-orig", async () => {
    // the seed captured the pre-existing template so a clone keeps its files
    expect(await fs.readFile(join(templateDir, "info", "exclude"), "utf8")).toContain(
      "custom-prev-template",
    );
    // the foreign post-checkout was set aside for the shim to chain to
    const orig = await fs.readFile(join(templateDir, "hooks", "post-checkout.ghostq-orig"), "utf8");
    expect(orig).toContain("prev-template-hook-ran");
    expect(await fs.readFile(shimPath, "utf8")).toContain("post-checkout.ghostq-orig");
  });

  test("git clone triggers apply: overlay linked, siblings intact, template seeded, prev hook chained", async () => {
    runGit(["clone", "-q", REMOTE, clone1], tmp, ENV);

    expect(runGit(["config", "remote.origin.url"], clone1, ENV)).toBe(REMOTE);
    const link = join(clone1, ".claude", "personal.md");
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(link, "utf8")).toBe("my notes\n");
    expect((await fs.lstat(join(clone1, ".env.local"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(join(clone1, ".claude", "settings.json"))).isFile()).toBe(true);
    // the seeded template gave the clone a normal .git/info/exclude ...
    expect(await fs.readFile(join(clone1, ".git", "info", "exclude"), "utf8")).toContain(
      "custom-prev-template",
    );
    // ... and the pre-existing template's post-checkout was chained
    expect((await fs.stat(join(clone1, "prev-template-hook-ran"))).isFile()).toBe(true);
  });

  test("ordinary git switch does not re-apply (null-ref sh gate)", async () => {
    await fs.unlink(join(clone1, ".env.local"));

    runGit(["switch", "-q", "-c", "feature"], clone1, ENV);
    runGit(["switch", "-q", "main"], clone1, ENV);

    // if the shim had invoked ghostq, the deleted link would be back
    expect(fs.lstat(join(clone1, ".env.local"))).rejects.toThrow();
  });

  test("a repo-local hook manager coexists: .git/hooks/pre-commit fires (nothing is shadowed)", async () => {
    // ghostq sets no core.hooksPath, so git uses the repo's own .git/hooks and
    // any hook a manager installs there keeps working, ghostq's post-checkout
    // sitting alongside it
    await fs.writeFile(
      join(clone1, ".git", "hooks", "pre-commit"),
      `#!/bin/sh\ntouch repo-local-precommit-ran\n`,
      { mode: 0o755 },
    );
    await fs.writeFile(join(clone1, "extra.txt"), "x\n");
    runGit(["add", "extra.txt"], clone1, ENV);
    runGit(["commit", "-q", "-m", "extra"], clone1, ENV);

    expect((await fs.stat(join(clone1, "repo-local-precommit-ran"))).isFile()).toBe(true);
    // ghostq's own post-checkout is still present, unclobbered
    expect((await fs.stat(join(clone1, ".git", "hooks", "post-checkout"))).isFile()).toBe(true);

    await fs.unlink(join(clone1, ".git", "hooks", "pre-commit"));
  });

  test("git worktree add triggers apply in the new worktree", async () => {
    const wt = join(tmp, "wt1");
    runGit(["worktree", "add", "-q", wt, "-b", "wt-branch"], clone1, ENV);

    expect((await fs.lstat(join(wt, ".env.local"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(join(wt, ".claude", "personal.md"))).isSymbolicLink()).toBe(true);
  });

  test("status reports identity and link states", () => {
    const r = ghostq(["status", clone1]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("identity: github.com/testuser/testrepo");
    expect(r.stdout).toContain(".claude/personal.md");
    // .env.local was deleted in the sh-gate test above
    expect(r.stdout).toContain("missing");
  });

  test("apply run by hand restores the missing link (idempotent)", async () => {
    const first = ghostq(["apply", clone1]);
    expect(first.status).toBe(0);
    expect((await fs.lstat(join(clone1, ".env.local"))).isSymbolicLink()).toBe(true);

    const second = ghostq(["apply", clone1]);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain("linked ");
  });

  test("uninstall restores the previous init.templateDir", async () => {
    const r = ghostq(["uninstall"]);
    expect(r.status).toBe(0);
    expect(gitConfig("init.templateDir")).toBe(prevTemplate);
    expect(fs.stat(shimPath)).rejects.toThrow();
  });
});
