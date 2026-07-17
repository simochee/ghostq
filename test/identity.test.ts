import { describe, expect, test } from "bun:test";
import { normalizeRemoteUrl } from "../src/identity.ts";

describe("remote URLs normalize to the host/user/repo overlay slug", () => {
  const table: [string, string | null][] = [
    ["https://github.com/simochee/ghostq.git", "github.com/simochee/ghostq"],
    ["https://github.com/simochee/ghostq", "github.com/simochee/ghostq"],
    ["https://github.com/simochee/ghostq/", "github.com/simochee/ghostq"],
    ["git@github.com:simochee/ghostq.git", "github.com/simochee/ghostq"],
    ["ssh://git@github.com/simochee/ghostq.git", "github.com/simochee/ghostq"],
    ["git://github.com/simochee/ghostq.git", "github.com/simochee/ghostq"],
    // non-GitHub hosts keep the host in the path
    ["https://gitlab.example.com/team/app.git", "gitlab.example.com/team/app"],
    ["git@forgejo.example.org:me/dotfiles.git", "forgejo.example.org/me/dotfiles"],
    // ssh ports and credentials are not part of the identity
    ["ssh://git@git.example.com:2222/team/app.git", "git.example.com/team/app"],
    ["https://user:pass@github.com/u/r.git", "github.com/u/r"],
    // GitLab subgroups nest deeper than user/repo
    ["https://gitlab.com/group/sub/repo.git", "gitlab.com/group/sub/repo"],
    // Backlog git: https keeps the /git/ prefix; scp-like SSH has a leading slash in the path
    ["https://example.backlog.jp/git/PROJ/repo.git", "example.backlog.jp/git/PROJ/repo"],
    ["example@example.git.backlog.jp:/PROJ/repo.git", "example.git.backlog.jp/PROJ/repo"],
    ["ssh://example@example.git.backlog.jp/PROJ/repo.git", "example.git.backlog.jp/PROJ/repo"],
    // hostless remotes have no overlay identity
    ["/absolute/local/path", null],
    ["../relative/path", null],
    ["file:///srv/git/repo.git", null],
    ["", null],
    // a crafted URL must not escape the overlay root
    ["https://github.com/../../etc/passwd", null],
  ];

  for (const [url, expected] of table) {
    test(`${JSON.stringify(url)} → ${expected === null ? "no identity" : expected}`, () => {
      expect(normalizeRemoteUrl(url)).toBe(expected);
    });
  }
});
