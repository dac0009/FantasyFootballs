#!/usr/bin/env bash
# Remove the ArcGIS Pro workspace this repository started life as.
#
# These files are not part of the application. The useful part of that era -- the
# exploratory notebook -- has been preserved (and sanitised) in notebooks/archive/.
#
# This only removes files from the current commit. It does NOT rewrite history;
# see docs/SECURITY.md if you need that.

set -euo pipefail
cd "$(dirname "$0")/.."

TARGETS=(
  "MyProject.aprx"
  "MyProject.atbx"
  "MyProject.gdb"
  "ffbffl.aprx"
  "ImportLog"
  "New Notebook.ipynb"
)

removed=0
for target in "${TARGETS[@]}"; do
  if [ -e "$target" ]; then
    git rm -r --quiet --ignore-unmatch -- "$target" 2>/dev/null || rm -rf -- "$target"
    echo "removed $target"
    removed=$((removed + 1))
  fi
done

if [ "$removed" -eq 0 ]; then
  echo "Nothing to remove; the legacy ArcGIS files are already gone."
else
  echo
  echo "$removed item(s) staged for removal. Review with 'git status', then commit:"
  echo "    git commit -m 'Remove legacy ArcGIS workspace'"
fi
