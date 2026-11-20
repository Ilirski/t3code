#!/usr/bin/env bash
# Fork only: updates this checkout, builds the desktop AppImage and installs it as the pacman
# package t3code-fork, reusing the AUR t3code-bin packaging. Replaces t3code-bin if installed.
#
#   scripts/fork-install-arch.sh            # git pull, build, install
#   scripts/fork-install-arch.sh --no-pull  # build and install the checkout as it is
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
[[ -x "$HOME/.local/share/vite-plus/bin/vp" ]] && PATH="$HOME/.local/share/vite-plus/bin:$PATH"
command -v vp >/dev/null || { echo "vp (Vite+) is not installed: https://viteplus.dev" >&2; exit 1; }
command -v cargo >/dev/null || { echo "Rust is not installed: sudo pacman -S rustup && rustup default stable" >&2; exit 1; }

sudo pacman -S --needed base-devel libsecret pkgconf imagemagick gtk3 nss alsa-lib mesa

[[ "${1:-}" == "--no-pull" ]] || git pull --ff-only
vp i
vp run dist:desktop:linux

version="$(node -p 'require("./apps/desktop/package.json").version')"
appimage="release/T3-Code-$version-x86_64.AppImage"
[[ -f "$appimage" ]] || { echo "Build did not produce $appimage" >&2; exit 1; }
# Every commit gets a higher pkgver so pacman always sees an upgrade.
pkgver="$version.r$(git rev-list --count HEAD).g$(git rev-parse --short HEAD)"

pkg="release/arch-pkg"
rm -rf "$pkg"
mkdir -p "$pkg"
cp "$appimage" "$pkg/T3-Code-$pkgver-x86_64.AppImage"
cp LICENSE "$pkg/LICENSE"
# shellcheck disable=SC2016
sed \
  -e 's/t3code-bin/t3code-fork/g' \
  -e "s/^pkgver=.*/pkgver=$pkgver/" \
  -e 's/^pkgrel=.*/pkgrel=1/' \
  -e 's|^  "\$_appimage::https.*|  "$_appimage"|' \
  -e 's|^  "\${pkgname}-\${pkgver}-LICENSE::https.*|  "LICENSE"|' \
  -e "s|^  '[0-9a-f]\{64\}' # .*|  'SKIP'|" \
  -e 's|"\$srcdir/\${pkgname}-\${pkgver}-LICENSE"|"$srcdir/LICENSE"|' \
  packaging/aur/t3code-bin/PKGBUILD >"$pkg/PKGBUILD"
if grep -qE '::https://|[0-9a-f]{64}' "$pkg/PKGBUILD"; then
  echo "packaging/aur/t3code-bin/PKGBUILD changed shape; update $0" >&2
  exit 1
fi

cd "$pkg"
makepkg -sif
echo "Installed t3code-fork $pkgver. Open T3 Code from your launcher or run: t3code"
