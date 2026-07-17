import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { applyFiles } from "../src/apply.ts";
import { resolveContext } from "../src/context.ts";
import { makeRepo, makeTmpDir, writeOverlayEntry } from "./helpers.ts";

const IDENTITY = "github.com/testuser/testrepo";
const REMOTE = "https://github.com/testuser/testrepo.git";

let tmp: string;
let repo: string;
let savedRoot: string | undefined;

beforeEach(async () => {
  tmp = await makeTmpDir("ghostq-apply");
  savedRoot = process.env.GHOSTQ_ROOT;
  process.env.GHOSTQ_ROOT = join(tmp, "overlay");
  repo = join(tmp, "repo");
  await makeRepo(
    repo,
    {
      ".gitignore": ".env.local\n.claude/personal.md\n",
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

describe("ghostq apply", () => {
  test("links each overlay file individually, leaving committed siblings intact", async () => {
    const entry = await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".claude/personal.md": "my notes\n",
      ".env.local": "SECRET=1\n",
    });

    const report = await applyFiles(await contextFor(repo));

    expect(report.linked.sort()).toEqual([".claude/personal.md", ".env.local"]);
    const link = join(repo, ".claude/personal.md");
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(link)).toBe(join(entry, ".claude/personal.md"));
    expect(await fs.readFile(link, "utf8")).toBe("my notes\n");
    // .claude/ holds both a committed file and an overlay link
    expect((await fs.lstat(join(repo, ".claude/settings.json"))).isFile()).toBe(true);
  });

  test("re-running apply is idempotent", async () => {
    await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".env.local": "SECRET=1\n",
    });
    const ctx = await contextFor(repo);

    await applyFiles(ctx);
    const second = await applyFiles(ctx);

    expect(second.linked).toEqual([]);
    expect(second.alreadyLinked).toEqual([".env.local"]);
  });

  test("an existing real file is never clobbered", async () => {
    await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".env.local": "overlay version\n",
    });
    await fs.writeFile(join(repo, ".env.local"), "local version\n");

    const report = await applyFiles(await contextFor(repo));

    expect(report.conflicts).toEqual([".env.local"]);
    expect(report.linked).toEqual([]);
    expect(await fs.readFile(join(repo, ".env.local"), "utf8")).toBe("local version\n");
    expect((await fs.lstat(join(repo, ".env.local"))).isSymbolicLink()).toBe(false);
  });

  test("a target that is not gitignored is warned about and skipped", async () => {
    await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      "not-in-gitignore.txt": "x\n",
    });

    const report = await applyFiles(await contextFor(repo));

    expect(report.notIgnored).toEqual(["not-in-gitignore.txt"]);
    expect(fs.lstat(join(repo, "not-in-gitignore.txt"))).rejects.toThrow();
  });

  test("a drifted ghostq symlink is repointed at the current overlay file", async () => {
    const entry = await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".env.local": "current\n",
      ".claude/personal.md": "notes\n",
    });
    // simulate a stale link left behind by an overlay reorganization
    await fs.symlink(join(entry, ".claude/personal.md"), join(repo, ".env.local"));

    const report = await applyFiles(await contextFor(repo));

    expect(report.relinked).toEqual([".env.local"]);
    expect(await fs.readlink(join(repo, ".env.local"))).toBe(join(entry, ".env.local"));
  });

  test("a repo without an origin remote is skipped quietly", async () => {
    const bare = await makeRepo(join(tmp, "noremote"), { "README.md": "x\n" });
    const res = await resolveContext(bare);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fatal).toBe(false);
  });

  test("a repo with no overlay entry reports hasEntry=false", async () => {
    const ctx = await contextFor(repo);
    expect(ctx.identity).toBe(IDENTITY);
    expect(ctx.hasEntry).toBe(false);
  });
});
