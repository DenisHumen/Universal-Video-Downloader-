#!/usr/bin/env bash
# Bring the signed dnf repository already on Pages into ./site, so a deploy of
# the website alone does not take it away: Pages replaces everything at once,
# and only a release can sign a new repository. Nothing there yet (the first
# deploy after a rename) is not an error; a repository that is there but only
# partly fetched is, since deploying it would break dnf for everyone.
#
# Needs: GH_REPO (owner/name).
set -euo pipefail
: "${GH_REPO:?}"
OWNER="${GH_REPO%%/*}"
NAME="${GH_REPO#*/}"
PAGES="https://$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]').github.io/$NAME"

mkdir -p site/rpm/repodata
get() { curl -fsSL --retry 3 -o "site/$1" "$PAGES/$1"; }

if ! get rpm/repodata/repomd.xml; then
  echo "No dnf repository at $PAGES yet; the website goes out on its own."
  rm -rf site/rpm
  exit 0
fi
get rpm/repodata/repomd.xml.asc
for file in uvd.gpg uvd.asc universal-video-downloader.repo; do get "$file"; done
# The instructions page; a deploy from before the website had it as index.html.
get repo.html || true
# Every file repomd.xml names, by its own href.
for href in $(grep -o 'href="repodata/[^"]*"' site/rpm/repodata/repomd.xml | sed 's/^href="//; s/"$//'); do
  get "rpm/$href"
done
echo "Kept the dnf repository from $PAGES:"; find site -type f | sort
