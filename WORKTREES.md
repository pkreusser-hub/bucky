# Working in this repo with several agents at once

One page. Read it before starting an agent, and the rest of the repo stays tidy on its own.

## The layout

| what | where |
|---|---|
| the main checkout — **stays on `main`** | `C:\Users\pkreu\OneDrive\Documents\BUCKY` |
| every agent worktree | `C:\dev\bucky-wt\<name>` |
| scratch, screenshots, throwaway scripts | the session's own scratchpad, never the repo |

**Worktrees live in `C:\dev\bucky-wt\`, not in OneDrive and not in `Temp`.** Both of those have
already cost this project real time:

- **OneDrive** syncs while agents write. CLAUDE.md records it settling two agents' writes *out of
  order* during a cross-file rename, leaving a page and its verify script holding mismatched
  names. It also tries to sync `tools/node_modules` and 550-file asset folders.
- **`AppData\Local\Temp`** is deleted by Windows Disk Cleanup without asking. A worktree lived
  there for twelve days before this cleanup found it.

## Starting an agent

```bash
git -C C:/Users/pkreu/OneDrive/Documents/BUCKY fetch origin
git -C C:/Users/pkreu/OneDrive/Documents/BUCKY worktree add C:/dev/bucky-wt/<name> -b <name> origin/main
```

Always branch from `origin/main`, never from whatever the main checkout happens to be on. Name
the worktree after the work (`gffl-waivers`, `fitness-push`), not after the agent.

## Finishing

```bash
git worktree remove C:/dev/bucky-wt/<name>     # refuses if anything is uncommitted — let it
git branch -d <name>                            # refuses if unmerged — let it
```

Both commands refuse rather than destroy. If one refuses, that is information: look before you
reach for `--force`. **Remove the worktree in the same session that finishes the work** — every
stale one found in this cleanup was abandoned mid-task, not deliberately kept.

## The four things that bite with several agents

1. **The stash stack is shared across every worktree.** A bare `git stash pop` in one can restore
   another agent's work. Use a throwaway WIP commit instead. If you must stash:
   `git stash push -u -m "<unique-tag>"`, find your own entry by tag, and `apply` it — never `pop`.

2. **Two agents editing one file.** `index.html`, `assets/league/lg-ui.js` and `farmkart.html` are
   the big shared surfaces. Give each agent an area, and before committing run
   `git diff --stat` and confirm every hunk is yours — CLAUDE.md has several entries that begin
   with someone else's changes turning up in a commit.

3. **Only `main` deploys.** Pushing a branch is free and safe; pushing to `main` puts it on
   amenfarms.netlify.app immediately. Never push to `main` without the user's preview approval.

4. **Rebase, don't merge, when `main` moves under you.** It has moved mid-task repeatedly here and
   rebased cleanly every time, because sessions own different files. Check for foreign commits in
   the range before you push.

## Before deleting anything

`git branch --merged origin/main` is the list you can delete safely. For anything it does *not*
list, run `git cherry -v origin/main <branch>`: a `-` means the patch is already upstream under a
different SHA (rebased), a `+` means it is genuinely unlanded. Both showed up in this repo, and
telling them apart is the whole job.

Two things that check has already caught people out on, both on 2026-08-17:

1. **Compare the branch, not the files that happen to be dirty.** A `git checkout` refusal names
   only the files blocking *it*. Auditing that list and concluding "nothing here is unlanded" misses
   everything else the branch changed. `git cherry` reads the whole history; the dirty list doesn't.

2. **A `+` means unlanded, never that it is wanted.** `origin/storytime-baked` is seven finished
   picture books that the user retired 22 minutes after they were built. Deleting it as "abandoned
   work" and landing it as "stranded work" are both wrong. Find out why it never landed — the
   commit that removed the feature usually says so in its message — before doing either.

**Branches kept on purpose** (do not delete; each is documented where its feature lives):

| branch | why |
|---|---|
| `origin/storytime-baked` | Story Time Jr's 7 offline picture books + the bake tool. Feature retired 2026-08-03; this branch is the archive. See `docs/farmgpt.md`. |
