import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { applyFiles, pruneFiles } from "../src/apply.ts";
import { resolveContext } from "../src/context.ts";
import { makeRepo, makeTmpDir, writeOverlayEntry } from "./helpers.ts";

const IDENTITY = "github.com/testuser/testrepo";
const REMOTE = "https://github.com/testuser/testrepo.git";

let tmp: string;
let repo: string;
let savedRoot: string | undefined;

beforeEach(async () => {
  tmp = await makeTmpDir("ghostq-prune");
  savedRoot = process.env.GHOSTQ_ROOT;
  process.env.GHOSTQ_ROOT = join(tmp, "overlay");
  repo = join(tmp, "repo");
  await makeRepo(
    repo,
    {
      ".gitignore": ".env.local\n.claude/personal.md\n.claude/nested/deep.md\nother.local\n",
      ".claude/settings.json": "{ \"committed\": true }\n",
      "README.md": "hello\n",
    },
    { remote: REMOTE },
  );
});

afterEach(async () => {
  if (savedRoot === undefined) delete process.env.GHOSTQ_ROOT;
  else process.env.GHOSTQ_ROOT = savedRoot;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function contextFor(dir: string) {
  const res = await resolveContext(dir);
  if (!res.ok) throw new Error(res.reason);
  return res.ctx;
}

describe("ghostq prune", () => {
  test("removes a dangling link left behind after its overlay file is deleted", async () => {
    const entry = await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".env.local": "SECRET=1\n",
    });
    const ctx = await contextFor(repo);
    await applyFiles(ctx);
    expect((await fs.lstat(join(repo, ".env.local"))).isSymbolicLink()).toBe(true);

    await fs.unlink(join(entry, ".env.local"));

    const report = await pruneFiles(ctx);

    expect(report.pruned).toEqual([".env.local"]);
    expect(fs.lstat(join(repo, ".env.local"))).rejects.toThrow();
  });

  test("leaves a live overlay link untouched", async () => {
    await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".env.local": "SECRET=1\n",
    });
    const ctx = await contextFor(repo);
    await applyFiles(ctx);

    const report = await pruneFiles(ctx);

    expect(report.pruned).toEqual([]);
    expect((await fs.lstat(join(repo, ".env.local"))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(join(repo, ".env.local"), "utf8")).toBe("SECRET=1\n");
  });

  test("leaves a real user file untouched", async () => {
    await fs.writeFile(join(repo, "other.local"), "not a symlink\n");
    const ctx = await contextFor(repo);

    const report = await pruneFiles(ctx);

    expect(report.pruned).toEqual([]);
    expect(await fs.readFile(join(repo, "other.local"), "utf8")).toBe("not a symlink\n");
  });

  test("leaves a symlink pointing outside the overlay entry untouched", async () => {
    const outside = join(tmp, "outside-target.txt");
    await fs.writeFile(outside, "user data\n");
    await fs.symlink(outside, join(repo, "other.local"));
    const ctx = await contextFor(repo);

    const report = await pruneFiles(ctx);

    expect(report.pruned).toEqual([]);
    expect((await fs.lstat(join(repo, "other.local"))).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(join(repo, "other.local"))).toBe(outside);
  });

  test("removes a now-empty directory left behind after pruning its only child", async () => {
    const entry = await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".claude/nested/deep.md": "deep notes\n",
    });
    const ctx = await contextFor(repo);
    await applyFiles(ctx);
    await fs.unlink(join(entry, ".claude/nested/deep.md"));

    const report = await pruneFiles(ctx);

    expect(report.pruned).toEqual([".claude/nested/deep.md"]);
    expect(report.removedDirs).toEqual([".claude/nested"]);
    expect(fs.stat(join(repo, ".claude/nested"))).rejects.toThrow();
    // .claude/ itself still holds a committed file, so it survives
    expect((await fs.stat(join(repo, ".claude"))).isDirectory()).toBe(true);
  });

  test("does not remove a directory that still has other entries", async () => {
    const entry = await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".claude/personal.md": "notes\n",
      ".claude/nested/deep.md": "deep notes\n",
    });
    const ctx = await contextFor(repo);
    await applyFiles(ctx);
    await fs.unlink(join(entry, ".claude/nested/deep.md"));

    const report = await pruneFiles(ctx);

    expect(report.pruned).toEqual([".claude/nested/deep.md"]);
    expect(report.removedDirs).toEqual([".claude/nested"]);
    // .claude/ still holds settings.json (committed) and personal.md (live link)
    expect((await fs.lstat(join(repo, ".claude/personal.md"))).isSymbolicLink()).toBe(true);
    expect((await fs.stat(join(repo, ".claude/settings.json"))).isFile()).toBe(true);
  });

  test("running prune twice is a no-op the second time", async () => {
    const entry = await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".env.local": "SECRET=1\n",
    });
    const ctx = await contextFor(repo);
    await applyFiles(ctx);
    await fs.unlink(join(entry, ".env.local"));

    const first = await pruneFiles(ctx);
    const second = await pruneFiles(ctx);

    expect(first.pruned).toEqual([".env.local"]);
    expect(second.pruned).toEqual([]);
    expect(second.removedDirs).toEqual([]);
  });
});
