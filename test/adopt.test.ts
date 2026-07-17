import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { adoptFiles } from "../src/adopt.ts";
import { applyFiles } from "../src/apply.ts";
import { resolveContext } from "../src/context.ts";
import { makeRepo, makeTmpDir, writeOverlayEntry } from "./helpers.ts";

const IDENTITY = "github.com/testuser/testrepo";
const REMOTE = "https://github.com/testuser/testrepo.git";

let tmp: string;
let repo: string;
let savedRoot: string | undefined;

beforeEach(async () => {
  tmp = await makeTmpDir("ghostq-adopt");
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

describe("ghostq adopt", () => {
  test("moves a gitignored real file into the overlay and replaces it with a symlink", async () => {
    await fs.writeFile(join(repo, ".env.local"), "SECRET=1\n");

    const [report] = await adoptFiles([".env.local"], repo);

    expect(report!.outcome).toBe("adopted");
    const overlayFile = join(process.env.GHOSTQ_ROOT!, IDENTITY, ".env.local");
    expect(await fs.readFile(overlayFile, "utf8")).toBe("SECRET=1\n");

    const link = join(repo, ".env.local");
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(link)).toBe(overlayFile);
    expect(await fs.readFile(link, "utf8")).toBe("SECRET=1\n");
  });

  test("after adopt, applyFiles reports the file as already linked", async () => {
    await fs.writeFile(join(repo, ".env.local"), "SECRET=1\n");
    await adoptFiles([".env.local"], repo);

    const report = await applyFiles(await contextFor(repo));

    expect(report.alreadyLinked).toEqual([".env.local"]);
    expect(report.linked).toEqual([]);
    expect(report.conflicts).toEqual([]);
  });

  test("a tracked (non-ignored) file is skipped and left as a real file", async () => {
    const [report] = await adoptFiles(["README.md"], repo);

    expect(report!.outcome).toBe("skipped-not-ignored");
    const st = await fs.lstat(join(repo, "README.md"));
    expect(st.isSymbolicLink()).toBe(false);
    expect(await fs.readFile(join(repo, "README.md"), "utf8")).toBe("hello\n");
  });

  test("a file already symlinked into the overlay is reported as already-adopted", async () => {
    await fs.writeFile(join(repo, ".env.local"), "SECRET=1\n");
    await adoptFiles([".env.local"], repo);

    const [second] = await adoptFiles([".env.local"], repo);

    expect(second!.outcome).toBe("already-adopted");
    const link = join(repo, ".env.local");
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
  });

  test("adopting is skipped when an overlay file already exists at the target", async () => {
    await writeOverlayEntry(process.env.GHOSTQ_ROOT!, IDENTITY, {
      ".env.local": "overlay version\n",
    });
    await fs.writeFile(join(repo, ".env.local"), "local version\n");

    const [report] = await adoptFiles([".env.local"], repo);

    expect(report!.outcome).toBe("skipped-conflict");
    expect(await fs.readFile(join(repo, ".env.local"), "utf8")).toBe("local version\n");
    expect((await fs.lstat(join(repo, ".env.local"))).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(join(process.env.GHOSTQ_ROOT!, IDENTITY, ".env.local"), "utf8")).toBe(
      "overlay version\n",
    );
  });

  test("a symlink pointing somewhere other than the overlay is skipped, not clobbered", async () => {
    const elsewhere = join(tmp, "elsewhere.txt");
    await fs.writeFile(elsewhere, "not overlay content\n");
    await fs.symlink(elsewhere, join(repo, ".env.local"));

    const [report] = await adoptFiles([".env.local"], repo);

    expect(report!.outcome).toBe("skipped-conflict");
    expect(await fs.readlink(join(repo, ".env.local"))).toBe(elsewhere);
  });

  test("passing a directory is rejected cleanly", async () => {
    const [report] = await adoptFiles([".claude"], repo);

    expect(report!.outcome).toBe("skipped-directory");
    expect((await fs.lstat(join(repo, ".claude"))).isDirectory()).toBe(true);
  });
});
