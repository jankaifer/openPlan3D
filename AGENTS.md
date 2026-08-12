# Working agreement for openPlan3D (Jan's fork)

SvelteKit + Three.js 2D/3D floor-plan editor. This file is the runbook for how
the agent works on this repo. **Follow it without asking for step-by-step
confirmation** — Jan does not want repeated back-and-forths.

## Fixing / building a change

1. Implement the change.
2. Typecheck before claiming done: `svelte-check` must be clean for the files
   you touched. Node isn't on the default PATH here; use the nixpkgs node, e.g.
   `export PATH="$(ls -d /nix/store/*-nodejs-22*/bin | head -1):$PATH"` then
   `node node_modules/.bin/svelte-check --tsconfig ./tsconfig.json`.
   (Pre-existing `BuildPanel.svelte` `annotate`/`measure` Tool errors are not
   yours — ignore them.)
3. Start a preview and give Jan the link. The preview MUST be seeded from prod:
   `bash scripts/dev-preview.sh [PORT]` (its own throwaway Postgres, dumped
   read-only from the prod `openplan3d` DB — never point a preview at prod).
4. Share the link on the **frame1.hobitin.eu** domain (not a raw IP), e.g.
   `http://frame1.hobitin.eu:8003/`.
5. Wait for Jan's approval before deploying.

## Deploying to prod (do ALL of this, no confirmations)

When Jan approves a change or says "deploy" / "push to prod", run the whole
pipeline end-to-end without stopping to ask:

1. **Clean commits on `main`, one per feature.** Conventional-commit messages,
   end each with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
   Keep unrelated local edits (e.g. Jan's own uncommitted experiments) out of
   the commits.
2. **Push the fork:** `git push origin main` (→ github.com/jankaifer/openPlan3D).
3. **Bump the homelab pin** in `/srv/claude-ui/workspace` (github.com/jankaifer/homelab):
   - `cd apps/openplan3d && nix flake update src`  (fetches the fork's new HEAD;
     the root `nix flake update openplan3d` alone only re-reads the stale
     subflake lock — do the subflake first).
   - `cd ../.. && nix flake update openplan3d`  (re-lock root to the new src).
   - Sanity-build the app: `nix build --no-link` in `apps/openplan3d`.
     If `package-lock.json` changed, update `npmDepsHash` in
     `apps/openplan3d/flake.nix` or the build fails.
   - Commit both lock files and `git push origin main`.
4. **Roll out to frame1** with deploy-rs over Tailscale (magicRollback +
   autoRollback stay on; the node's configured hostname is the LAN IP, so
   override to the Tailscale host — the homelab guardrail requires it):
   ```
   cd /srv/claude-ui/workspace
   nix run .#deploy -- .#frame1 --hostname 100.91.94.7 --skip-checks
   ```
5. **Verify:** `systemctl is-active openplan3d.service` is `active` and it serves
   `200` (currently `http://127.0.0.1:3220/`); confirm `ExecStart` points at the
   new `/nix/store/...-openplan3d-*` build path.

Prod is self-hosted on **frame1** (this machine) as `openplan3d.service`. There
is Firebase App Hosting config in the repo (`apphosting.yaml`) but it is NOT the
prod path — ignore it.

Notes:
- The homelab `deploy` policy lives in `/srv/claude-ui/workspace/AGENTS.md`
  ("Deployment Policy"). Never `nixos-rebuild switch` prod directly.
- Deploying from this agent shell is safe: `claude-ui.service` has
  restart/stop-if-changed disabled, so activation won't kill the session.
