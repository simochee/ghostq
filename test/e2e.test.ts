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
const hooksDir = join(xdg, "ghostq", "hooks");
const overlayRoot = join(xdg, "ghostq", "overlay");
const prevHooks = join(tmp, "prev-hooks");
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
  test("setup: upstream repo, overlay entry, and a pre-existing global hooksPath", async () => {
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

    // a hooksPath that predates ghostq install and must keep working
    await fs.mkdir(prevHooks, { recursive: true });
    await fs.writeFile(
      join(prevHooks, "post-checkout"),
      `#!/bin/sh\ntouch prev-global-hook-ran\n`,
      { mode: 0o755 },
    );
    run("git", ["config", "--global", "core.hooksPath", prevHooks], { env: ENV });
  });

  test("install sets core.hooksPath and records the previous one", async () => {
    const r = ghostq(["install"]);
    expect(r.status).toBe(0);
    expect(gitConfig("core.hooksPath")).toBe(hooksDir);
    const shim = await fs.readFile(join(hooksDir, "post-checkout"), "utf8");
    expect(shim.startsWith("#!/bin/sh")).toBe(true);
    expect(shim).toContain(prevHooks);
  });

  test("git clone triggers apply: overlay files are linked, siblings intact", async () => {
    runGit(["clone", "-q", REMOTE, clone1], tmp, ENV);

    expect(runGit(["config", "remote.origin.url"], clone1, ENV)).toBe(REMOTE);
    const link = join(clone1, ".claude", "personal.md");
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(link, "utf8")).toBe("my notes\n");
    expect((await fs.lstat(join(clone1, ".env.local"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(join(clone1, ".claude", "settings.json"))).isFile()).toBe(true);
    // the pre-existing global hook was chained during the clone checkout
    expect((await fs.stat(join(clone1, "prev-global-hook-ran"))).isFile()).toBe(true);
  });

  test("ordinary git switch does not re-apply (null-ref sh gate)", async () => {
    await fs.unlink(join(clone1, ".env.local"));

    runGit(["switch", "-q", "-c", "feature"], clone1, ENV);
    runGit(["switch", "-q", "main"], clone1, ENV);

    // if the shim had invoked ghostq, the deleted link would be back
    expect(fs.lstat(join(clone1, ".env.local"))).rejects.toThrow();
  });

  test("the dispatcher chains to a repo-local post-checkout hook", async () => {
    await fs.writeFile(
      join(clone1, ".git", "hooks", "post-checkout"),
      `#!/bin/sh\ntouch repo-local-hook-ran\n`,
      { mode: 0o755 },
    );

    runGit(["switch", "-q", "feature"], clone1, ENV);

    expect((await fs.stat(join(clone1, "repo-local-hook-ran"))).isFile()).toBe(true);
    runGit(["switch", "-q", "main"], clone1, ENV);
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

  test("uninstall restores the previous core.hooksPath", async () => {
    const r = ghostq(["uninstall"]);
    expect(r.status).toBe(0);
    expect(gitConfig("core.hooksPath")).toBe(prevHooks);
    expect(fs.stat(join(hooksDir, "post-checkout"))).rejects.toThrow();
  });
});
