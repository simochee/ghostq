<div align="center">

# 👻 ghostq

**Your personal per-repo files, restored automatically on every clone and worktree.**

[![CI](https://github.com/simochee/ghostq/actions/workflows/ci.yml/badge.svg)](https://github.com/simochee/ghostq/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40simochee%2Fghostq)](https://www.npmjs.com/package/@simochee/ghostq)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![runtime: Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)

</div>

Your personal files — `.claude/` notes, `.env.local`, editor scratch configs —
live in a separate **overlay tree** (a stable source of truth). `ghostq`
symlinks them into the real checkout via a git `post-checkout` hook, so a fresh
clone or `git worktree add` comes up with your personal files already in place.

No more re-creating `.env.local` by hand every time you clone. No more losing
your scratch configs to a new worktree.

## ⚡ Quick start

ghostq ships as a single self-contained binary — no runtime needed on the
machine that runs it. Build it once (see [DEVELOPMENT.md](./DEVELOPMENT.md)) or
grab a prebuilt binary, put it on your `PATH`, then:

```sh
ghostq install                    # one-time: hook future clones & worktrees

# bring a personal file for a repo you already have under ghostq:
cd path/to/your/repo
echo "TOKEN=..." > .env.local     # a gitignored, personal file
ghostq adopt .env.local           # moves it into the overlay + symlinks it back
```

Every fresh `git clone` or `git worktree add` of that repo now restores
`.env.local` automatically. For a repo you cloned **before** installing ghostq,
run `ghostq apply` in it once.

## 📖 Commands

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

## 🗂️ Overlay layout

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

## 🔧 How it works

- On a fresh `git clone` or `git worktree add`, ghostq looks up an overlay
  entry by the repo's remote identity (`host/user/repo`) and symlinks its files
  into the checkout. An ordinary `git switch` / `git checkout` does nothing.
- **symlink-each:** files are linked one by one, so a directory like `.claude/`
  can hold committed files next to your overlay-linked personal files — whole
  directories are never symlinked.
- Repos with no `origin` remote, or no matching overlay entry, are skipped
  quietly.

How the hook itself is wired (`init.templateDir`, the null-ref gate, migration
from older versions) is an implementation detail — see
[DEVELOPMENT.md](./DEVELOPMENT.md).

## 🤝 Coexisting with lefthook (and other hook managers)

ghostq doesn't take over your hooks. Install lefthook, husky, pre-commit, or
your own `.git/hooks` scripts exactly as you normally would — there's nothing
special to do, and nothing to undo. Hooks like `pre-commit` and `pre-push`
coexist with no caveat.

> [!WARNING]
> `git worktree add` runs a single shared `.git/hooks/post-checkout`. If your
> own hook config *also* uses `post-checkout` (e.g. a `post-checkout:` block in
> `lefthook.yml`), it takes that slot and ghostq won't auto-link **new
> worktrees** of that repo — run `ghostq apply` in the new worktree by hand.
> Clones, and every other hook, are unaffected.

## 🛡️ Safety

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

## 🧭 ghq-shaped, not ghq-bound

The overlay tree mirrors the same `host/user/repo` layout that
[ghq](https://github.com/x-motemen/ghq) uses — ghq's directory-structure
philosophy is the direct inspiration for this tool, and credit goes to it.

That said, **ghostq is standalone and has zero runtime dependency on ghq**. It
does not import ghq, shell out to it, or read `~/ghq`; ghq does not need to be
installed. ghostq arrives at the `host/user/repo` layout independently, by
normalizing the repo's remote URL — the same transform ghq performs, computed
on its own.

## 🚫 Non-goals

- No dependency on or integration with ghq at runtime.
- Not a general dotfiles / home manager. ghostq is specifically the per-repo
  overlay plus the auto-trigger on clone / worktree add.
- Committed or shared files are out of scope — only personal, gitignored,
  per-repo files.

## 💛 Contributing

Build, test, and architecture notes live in [DEVELOPMENT.md](./DEVELOPMENT.md).
Guidance for AI coding agents lives in [AGENTS.md](./AGENTS.md).
