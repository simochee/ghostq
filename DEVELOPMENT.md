# Development

What ghostq does and why is covered in the [README](./README.md); this
document covers working on it.

## Prerequisites

[Bun](https://bun.sh) ≥ 1.2. Nothing else — git is invoked as a subprocess,
and the test suite drives the real git on your machine.

## Commands

```sh
bun install            # dependencies (commander for CLI parsing, bundled into the binary)
bun test               # unit + end-to-end suite
bun run typecheck      # tsc --noEmit
bun run build          # bun build --compile → dist/ghostq (single binary)
```

## Source layout

```
src/
  index.ts      CLI entry: subcommand router and all user-facing output
  context.ts    repo root + remote → identity → overlay entry resolution
  identity.ts   remote URL → host/user/repo normalization (pure function)
  apply.ts      per-file state inspection and symlink-each application
  install.ts    hook install/uninstall via init.templateDir; the POSIX sh hook
  git.ts        spawnSync wrapper around the git CLI
  paths.ts      overlay root / template dir / XDG resolution
```

Commands print from `index.ts` only; the modules underneath return data. That
is what makes `apply` and `status` share one inspection pass
(`inspectFiles`) and keeps the tests assertion-based instead of
output-scraping.

## Hook installation (init.templateDir)

`ghostq install` sets a global `init.templateDir`, not `core.hooksPath`. git
copies that template into `.git/` on every clone / `git init`, seeding a
`post-checkout` hook — and ghostq then stays out of the hooks path, so a repo's
own `.git/hooks` (lefthook, husky, pre-commit, plain scripts) keep working. A
global `core.hooksPath` would instead shadow every repo-local hook and trip
those tools' install guards; avoiding it is the whole point (AGENTS.md invariant
2 spells out why).

- **Seeding.** Overriding `init.templateDir` would otherwise drop git's default
  template, so install first reproduces the currently-effective template (the
  user's own, or git's built-in) via a throwaway `git init` and copies its
  `info/`, `description`, and sample hooks in — clones keep their usual
  `.git/info/exclude` and friends.
- **The hook** is pure POSIX sh and gates on the null-ref fast path: only a
  fresh clone / `git worktree add` reports the all-zeros previous HEAD with the
  branch flag set, so an ordinary switch/checkout never spawns the binary. A
  `post-checkout` the template already carried is preserved as
  `post-checkout.ghostq-orig` and chained.
- **Migration.** install/uninstall detect a legacy `core.hooksPath` still
  pointing at ghostq's old hooks dir, restore the hooksPath it had recorded (or
  unset it), and remove the stale dir — otherwise that leftover config keeps
  shadowing the template hook after an upgrade.

## How the tests are structured

- `test/identity.test.ts` — table-driven spec of URL normalization: https,
  scp-like SSH, `ssh://` with port, credentials, subgroups, Backlog URLs,
  hostless remotes, and traversal attempts.
- `test/apply.test.ts` — behavior of a single apply pass against a throwaway
  git repo: symlink-each, sibling files untouched, idempotency, no-clobber,
  gitignore gating, drift repair.
- `test/prune.test.ts` — removal of dangling ghostq-managed links: live links
  and non-ghostq files are left alone, empty parent directories are cleaned
  up (but not directories with other entries), and pruning is idempotent.
- `test/e2e.test.ts` — compiles the real binary, then drives real
  `git clone` / `git switch` / `git worktree add` inside an isolated
  HOME / `GIT_CONFIG_GLOBAL` sandbox. Two tricks worth knowing:
  - The sandbox clones `https://github.com/testuser/testrepo.git` from a
    local directory via `url.<dir>.insteadOf`, so `remote.origin.url` keeps
    the GitHub-shaped value while no network is touched. This also documents
    why identity resolution reads `git config remote.origin.url` rather than
    `git remote get-url` (which would apply the rewrite).
  - "The sh gate skipped ghostq" is asserted behaviorally: delete a link,
    `git switch` twice, and assert the link did **not** come back.

## Distribution

`bun run build` produces a self-contained binary with the Bun runtime
embedded, so a fresh machine needs no Node/Bun to run it — this tool is
bootstrap-adjacent, which is why the binary (not an npm install) is the
primary artifact. `package.json` still exposes `bin` pointing at
`src/index.ts` for running from a checkout with Bun.

When `ghostq install` runs from a compiled binary, the generated hook invokes
that binary's absolute path. When it runs from source (`bun src/index.ts`),
it writes a `ghostq-dev` wrapper next to the hook that re-invokes Bun with
the entry script — so hooks work in development too.
