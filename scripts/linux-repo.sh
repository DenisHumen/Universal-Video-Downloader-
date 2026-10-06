#!/usr/bin/env bash
# Build the signed apt and dnf repositories for one release.
#
# The packages themselves stay where they already are, on the GitHub release:
# a hundred megabytes per version does not belong on Pages, and Releases has no
# stated bandwidth cap. Only the small, signed index files move:
#
#   apt  A flat repository attached to the release itself (Packages, Release,
#        InRelease, Release.gpg). Users point apt at releases/latest/download/,
#        which redirects to the newest release, so its index and its .deb always
#        come from the same release.
#   dnf  Repodata on Pages whose xml:base points at the release, so dnf fetches
#        the .rpm from GitHub. repomd.xml is signed (repo_gpgcheck=1) and pins
#        each package's SHA-256, which is why the .rpm itself needs no signature.
#
# Needs: TAG (v1.2.3), GH_REPO (owner/name), FPR (signing key fingerprint),
# PASSFILE (passphrase file, may be empty), gh, apt-ftparchive, createrepo_c, gpg.
# Writes ./apt (to attach to the release) and ./site (to deploy to Pages).
# For a local dry run, set LOCAL_DEB/LOCAL_RPM to files instead of using gh.
set -euo pipefail

: "${TAG:?}" "${GH_REPO:?}" "${FPR:?}"
PASSFILE="${PASSFILE:-/dev/null}"
OWNER="${GH_REPO%%/*}"
NAME="${GH_REPO#*/}"
PAGES="https://$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]').github.io/$NAME"
DOWNLOAD="https://github.com/$GH_REPO/releases/download/$TAG/"

sign() { gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASSFILE" --local-user "$FPR" "$@"; }

rm -rf apt site
mkdir -p apt site/rpm

# ---- apt: a flat repository next to the .deb -------------------------------
if [ -n "${LOCAL_DEB:-}" ]; then cp "$LOCAL_DEB" apt/; else gh release download "$TAG" --dir apt --pattern '*.deb'; fi
(
  cd apt
  apt-ftparchive packages . > Packages
  gzip -9kf Packages
  # Written outside the folder first, so the Release file never hashes itself.
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin="Universal Video Downloader" \
    -o APT::FTPArchive::Release::Label="Universal Video Downloader" \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Architectures=amd64 \
    release . > ../Release.tmp
  mv ../Release.tmp Release
  sign --clearsign --output InRelease Release
  sign --armor --detach-sign --output Release.gpg Release
  rm -f ./*.deb
)

# ---- dnf: repodata on Pages, packages on the release -----------------------
if [ -n "${LOCAL_RPM:-}" ]; then cp "$LOCAL_RPM" site/rpm/; else gh release download "$TAG" --dir site/rpm --pattern '*.rpm'; fi
createrepo_c --baseurl "$DOWNLOAD" site/rpm
sign --armor --detach-sign --output site/rpm/repodata/repomd.xml.asc site/rpm/repodata/repomd.xml
rm -f site/rpm/*.rpm

# ---- the key and the instructions ------------------------------------------
gpg --batch --export "$FPR" > site/uvd.gpg
gpg --batch --armor --export "$FPR" > site/uvd.asc

cat > site/universal-video-downloader.repo <<EOF
[universal-video-downloader]
name=Universal Video Downloader
baseurl=$PAGES/rpm
enabled=1
gpgcheck=0
repo_gpgcheck=1
gpgkey=$PAGES/uvd.asc
EOF

cat > site/index.html <<EOF
<!doctype html><meta charset="utf-8"><title>Universal Video Downloader repositories</title>
<h1>Universal Video Downloader — apt and dnf</h1>
<p>Ubuntu, Debian, Mint:</p>
<pre>curl -fsSL $PAGES/uvd.gpg | sudo tee /usr/share/keyrings/uvd.gpg &gt; /dev/null
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/uvd.gpg] https://github.com/$GH_REPO/releases/latest/download/ ./" | sudo tee /etc/apt/sources.list.d/universal-video-downloader.list
sudo apt update &amp;&amp; sudo apt install universal-video-downloader</pre>
<p>Fedora, RHEL, openSUSE:</p>
<pre>sudo curl -fsSL -o /etc/yum.repos.d/universal-video-downloader.repo $PAGES/universal-video-downloader.repo
sudo dnf install universal-video-downloader</pre>
<p>Current release: $TAG</p>
EOF

echo "apt index:"; ls -l apt
echo "site:"; find site -type f | sort
