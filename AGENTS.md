# AGENTS.md

Instructions for AI coding agents working in this repository.

## Orientation

- What ghostq is, its positioning, and user-facing behavior: [README.md](./README.md)
- Build/test commands, source layout, test structure: [DEVELOPMENT.md](./DEVELOPMENT.md)

Verify every change with `bun test` and `bun run typecheck` before finishing.

## Invariants — do not break these

1. **The post-checkout shim stays pure POSIX sh.** No bashisms, and the
   ghostq binary must never be spawned on an ordinary `git switch` /
   `git checkout` — only when the previous HEAD is the null ref with the
   branch flag set (fresh clone / `git worktree add`).
2. **Install via `init.templateDir`, never `core.hooksPath`.** ghostq seeds a
   single `post-checkout` into `.git/hooks` at clone/init time and then stays out
   of the hooks path, so lefthook/husky/pre-commit/plain scripts install into
   `.git/hooks` and fire untouched — no shims, no forwarding. Setting
   `core.hooksPath` would shadow every repo-local hook and trip those tools'
   install guards; that is exactly the coexistence bug this design avoids. The
   template must also seed git's default files (`info/exclude`, `description`,
   sample hooks) so the override doesn't silently strip them from clones, and
   preserve any foreign `post-checkout` it displaces as `post-checkout.ghostq-orig`,
   chaining to it. Accepted limitation: `git worktree add` runs the one shared
   `.git/hooks/post-checkout`, so a tool whose config also owns `post-checkout`
   displaces ghostq for new worktrees of that repo (manual `ghostq apply`) — a
   git single-slot limitation, not one to design around. `install`/`uninstall`
   must also migrate off a legacy core.hooksPath install (ghostq before this
   switch): a leftover global core.hooksPath keeps shadowing `.git/hooks` and
   would silently defeat the template hook for upgraders.
3. **Zero runtime dependency on ghq.** Never import ghq, shell out to it, or
   read `~/ghq`. The `host/user/repo` layout is computed independently from
   the remote URL.
4. **Identity comes from `remote.origin.url` via `git config`**, never from
   the filesystem path (worktrees live anywhere) and never via
   `git remote get-url` (it applies `url.<x>.insteadOf` rewrites).
5. **symlink-each, never whole directories** — target directories may hold
   committed files next to overlay links.
6. **Never clobber.** An existing file that is not a ghostq-managed link is
   warned about and left alone. A target that is not gitignored is skipped.
7. **Apply stays idempotent** and quiet-skips repos with no `origin`,
   hostless remotes, or no overlay entry.

The e2e suite encodes these invariants; a change that makes
`test/e2e.test.ts` awkward is probably breaking one of them.

## Conventions

- Runtime dependencies: none, and keep it that way. git is invoked via
  `spawnSync`.
- Only `src/index.ts` prints; other modules return data structures.
- Where information belongs: code says How, tests say What (spec-style test
  names), commit bodies say Why, code comments say only Why-not (why the
  obvious approach was not taken).
