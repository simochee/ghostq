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

1. `ghostq install` sets a global `init.templateDir` — the directory git copies
   into `.git/` on every `git clone` and `git init`. ghostq's template carries a
   single `post-checkout` hook (and a seeded copy of git's default template, so
   clones still get their usual `.git/info/exclude`, `description`, and sample
   hooks). Crucially, ghostq does **not** set `core.hooksPath`.
2. The hook is pure POSIX sh. Because it is copied into the repo's own
   `.git/hooks/` and ghostq never claims `core.hooksPath`, git keeps using
   `.git/hooks/` normally — so lefthook, husky, pre-commit, and plain scripts
   install right alongside it and fire untouched, no shims or forwarding needed.
   The hook gates on the null-ref fast path: only a fresh `git clone` or
   `git worktree add` reports the all-zeros ref as the previous HEAD. Ordinary
   `git switch` / `git checkout` exits right there — the `ghostq` binary is never
   spawned on the hot path.
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
- `apply` only ever creates or repoints links; it never removes one, even
  after the overlay file behind it is deleted. `ghostq prune` cleans up the
  resulting dangling link — a symlink that still points into this repo's
  overlay entry but whose target no longer exists — and removes any parent
  directory left empty as a result. Live links and non-ghostq files are never
  touched.

## Coexisting with lefthook (and other hook managers)

ghostq doesn't take over your hooks. Install lefthook, husky, pre-commit, or
your own `.git/hooks` scripts exactly as you normally would — there's nothing
special to do, and nothing to undo. Hooks like `pre-commit` and `pre-push`
coexist with no caveat.

**Limitation.** `git worktree add` runs a single shared
`.git/hooks/post-checkout`. If your own hook config *also* uses `post-checkout`
(e.g. a `post-checkout:` block in `lefthook.yml`), it takes that slot and ghostq
won't auto-link **new worktrees** of that repo — run `ghostq apply` in the new
worktree by hand. Clones, and every other hook, are unaffected.

Separately, for a repo you cloned **before** installing ghostq, run
`ghostq apply` once.

## Install

ghostq ships as a single self-contained binary — no runtime needed on the
machine that runs it. Build it once (see [DEVELOPMENT.md](./DEVELOPMENT.md))
or grab a prebuilt binary, put it on your `PATH`, then:

```sh
ghostq install
```

## Usage

```
ghostq install           install the post-checkout hook globally (init.templateDir)
ghostq apply [path]      link overlay files into the checkout (idempotent)
ghostq adopt <file>...   move existing gitignored files into the overlay and link them
ghostq status [path]     show link states and warnings without changing anything
ghostq prune [path]      remove dangling ghostq-managed links (idempotent)
ghostq root              print the overlay root
ghostq uninstall         remove the hook wiring
```

### Adopting an existing file

If a personal file already exists as a real file in your checkout (instead of
having been set up in the overlay first), `ghostq adopt <file>...` moves it
into this repo's overlay entry and replaces it with the same kind of symlink
`apply` would produce — one command instead of manually creating the overlay
directory and copying the file over.

Each file passed to `adopt` must already be gitignored (`adopt` never adopts a
tracked file) and must be a real file, not a symlink or a directory — pass
individual files; ghostq never links whole directories (symlink-each). If the
overlay already has a file at the target path, or the checkout path is already
a symlink pointing elsewhere, `adopt` warns and skips it rather than
clobbering anything.

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
