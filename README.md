# ghostq

[![npm version](https://img.shields.io/npm/v/%40simochee%2Fghostq)](https://www.npmjs.com/package/@simochee/ghostq)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![runtime: Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)

Restore your gitignored per-repo files automatically on every clone and
worktree via a git hook.

Your personal files — `.claude/` notes, `.env.local`, editor scratch configs —
live in a separate **overlay tree** (a stable source of truth). `ghostq`
symlinks them into the real checkout via a git `post-checkout` hook, so a fresh
clone or `git worktree add` comes up with your personal files already in place.

## ghq-shaped, not ghq-bound

The overlay tree mirrors the same `host/user/repo` layout that
[ghq](https://github.com/x-motemen/ghq) uses — ghq's directory-structure
philosophy is the direct inspiration for this tool, and credit goes to it.

That said, **ghostq is standalone and has zero runtime dependency on ghq**. It
does not import ghq, shell out to it, or read `~/ghq`; ghq does not need to be
installed. ghostq arrives at the `host/user/repo` layout independently, by
normalizing the repo's remote URL — the same transform ghq performs, computed
on its own.

## How it works

1. `ghostq install` sets a global `core.hooksPath` pointing at a generated
   `post-checkout` dispatcher.
2. The dispatcher is pure POSIX sh. On every checkout it first chains to any
   hook it shadows (a previously configured global hooksPath, and the
   repo-local `.git/hooks/post-checkout` used by lefthook and friends), then
   gates on the null-ref fast path: only a fresh `git clone` or
   `git worktree add` reports the all-zeros ref as the previous HEAD. Ordinary
   `git switch` / `git checkout` exits right there — the `ghostq` binary is
   never spawned on the hot path.
3. On a fresh clone / worktree, `ghostq apply` runs:
   - resolves the repo's identity from `remote.origin.url`, normalized to
     `host/user/repo` (https, scp-like SSH, trailing `.git`, ports and
     credentials all handled; non-GitHub hosts keep their hostname in the
     path). Worktrees live at arbitrary paths, so identity comes from the
     remote, never from the filesystem location.
   - looks up the overlay entry at `<overlay-root>/<host>/<user>/<repo>/`.
     The entry's contents **are** the manifest — no separate include file.
   - symlinks each file individually, mirroring the relative structure
     (**symlink-each**): a directory like `.claude/` can hold committed files
     and overlay-linked personal files side by side. Whole directories are
     never symlinked.

Repos with no `origin` remote, hostless remote URLs, or no overlay entry are
skipped quietly.

### Safety

- Before linking, each target path is checked with `git check-ignore`; a path
  that is not gitignored is warned about and skipped, so ghostq never dirties
  the working tree or sets up an accidental commit.
- Apply is idempotent: already-correct links are skipped, and an existing real
  file that is not a ghostq-managed link is never clobbered — it is warned
  about and left alone.

## Install

ghostq ships as a single self-contained binary — no runtime needed on the
machine that runs it. Build it once (see [DEVELOPMENT.md](./DEVELOPMENT.md))
or grab a prebuilt binary, put it on your `PATH`, then:

```sh
ghostq install
```

## Usage

```
ghostq install           set up the global post-checkout hook (core.hooksPath)
ghostq apply [path]      link overlay files into the checkout (idempotent)
ghostq status [path]     show link states and warnings without changing anything
ghostq root              print the overlay root
ghostq uninstall         remove the hook wiring
```

## Overlay layout

Default overlay root: `${XDG_CONFIG_HOME:-~/.config}/ghostq/overlay`,
overridable with `GHOSTQ_ROOT`.

```
~/.config/ghostq/overlay/
└── github.com/
    └── simochee/
        └── ghostq/
            ├── .claude/
            │   └── personal.md      → symlinked into every checkout/worktree
            └── .env.local
```

Making the overlay root itself a git repo is recommended (not required) so
your personal files are versioned and sync across machines.

## Non-goals

- No dependency on or integration with ghq at runtime.
- Not a general dotfiles / home manager. ghostq is specifically the per-repo
  overlay plus the auto-trigger on clone / worktree add.
- Committed or shared files are out of scope — only personal, gitignored,
  per-repo files.

## Contributing

Build, test, and architecture notes live in [DEVELOPMENT.md](./DEVELOPMENT.md).
Guidance for AI coding agents lives in [AGENTS.md](./AGENTS.md).
