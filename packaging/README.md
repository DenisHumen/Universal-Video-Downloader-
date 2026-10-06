# Distribution channels

Every channel below is wired into `.github/workflows/release.yml` and runs after a release is
published. A channel whose secret is missing is skipped with a notice; the release itself never
depends on it.

| Channel | Secret(s) | One-time setup by the owner |
| --- | --- | --- |
| apt + dnf repositories | `REPO_GPG_PRIVATE_KEY`, `REPO_GPG_PASSPHRASE` (may be empty) | Pages source = GitHub Actions; `github-pages` environment allows `v*` tags. Done. |
| AUR (`universal-video-downloader-bin`) | `AUR_KEY` (SSH private key), optional `AUR_EMAIL` | Create an account at aur.archlinux.org, add the public half of the key to it. The first push creates the package. |
| winget (`DenisHumen.UniversalVideoDownloader`) | `WINGET_TOKEN` (classic token, `public_repo`) | Submit the first version by hand (`wingetcreate new <installer URL>` or komac) as a pull request to microsoft/winget-pkgs. Later versions are submitted automatically. |

The apt index is attached to each release and the dnf repodata lives on Pages; the packages
themselves are always the release's own `.deb` and `.rpm`. See `scripts/linux-repo.sh`.

Windows builds are unsigned, so SmartScreen may say "Windows protected your PC": More info → Run
anyway.
