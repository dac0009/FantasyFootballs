# How to apply this to your repository

The archive contains the complete repository contents. `node_modules/` is excluded
(run `npm install` in `web/`).

## Option A — clean slate (recommended, and it removes the credential history)

```bash
# 1. Rotate your ESPN cookies FIRST (docs/SECURITY.md), before anything else.

cd /path/to/FantasyFootballs
unzip -o ~/Downloads/FantasyFootballs-rebuild.zip -d .

# ESSENTIAL: delete the old ArcGIS files and the original credential-bearing
# notebook from disk BEFORE committing. Without this, `git add -A` below would
# copy the leaked cookies straight into your brand-new "clean" history.
bash scripts/remove_legacy_arcgis.sh

git checkout --orphan clean-main
git add -A
git commit -m "Rebuild as a static league archive and analytics site"
git branch -D main && git branch -m main
git push --force origin main
```

This replaces history, which is what removes the leaked cookies from every old commit.
Ask GitHub Support to purge cached views afterwards — old commits stay reachable by SHA.

## Option B — keep history (does NOT remove the leaked credentials)

```bash
cd /path/to/FantasyFootballs
unzip -o ~/Downloads/FantasyFootballs-rebuild.zip -d .
bash scripts/remove_legacy_arcgis.sh
git add -A && git commit -m "Rebuild as a static league archive and analytics site"
git push
```

## Then, on GitHub

1. **Settings → Secrets and variables → Actions** → add `SWID` and `ESPN_S2`.
2. **Settings → Pages** → set **Source** to **GitHub Actions**.
3. **Actions → Refresh ESPN data → Run workflow.** This replaces the committed sample
   data with your league's real history and deploys the site.

The repository ships with generated sample data, so the site builds and every page works
before you add credentials. A banner marks it as sample data until the first real refresh.

## First things worth checking after the real refresh

```bash
python -m pipeline inspect   # counts, and any documented data gaps
python -m pipeline owners    # the owner identity map and every team-name timeline
python -m pipeline probe     # exactly which ESPN views your league exposes, per season
```

`owners` is the one to look at closely: it will show whether anyone needs merging in
`config/owners.yml`, and whether any team came back `unlinked`.
