#!/usr/bin/env bash
# Build in a new, disposable Linux directory; never alter a developer checkout.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
source "$repo/scripts/pdfium/versions.env"
if [[ $# != 1 ]]; then
  echo "Usage: $0 /absolute/path/to/new-build-directory" >&2
  exit 2
fi
work=$1
[[ $work == /* && ! -e $work ]] || { echo 'Build directory must be an absolute path that does not exist.' >&2; exit 2; }
for revision in "$PDFIUM_REVISION" "$BUILDER_REVISION" "$DEPOT_TOOLS_REVISION" "$EMSDK_REVISION"; do
  [[ $revision =~ ^[0-9a-f]{40}$ ]] || { echo 'Revisions must be full commit hashes.' >&2; exit 2; }
done
mkdir -p "$work"
clone_revision() {
  git clone --no-checkout "$1" "$2"
  git -C "$2" checkout --detach "$3"
  [[ $(git -C "$2" rev-parse HEAD) == "$3" ]]
}
clone_revision https://github.com/espresso3389/pdfium-binaries.git "$work/builder" "$BUILDER_REVISION"
cd "$work/builder"
clone_revision https://chromium.googlesource.com/chromium/tools/depot_tools.git depot_tools "$DEPOT_TOOLS_REVISION"
export DEPOT_TOOLS_UPDATE=0 DEPOT_TOOLS_WIN_TOOLCHAIN=0
export PATH="$PWD/depot_tools:$PATH"
export PDFium_TARGET_OS=emscripten PDFium_TARGET_CPU=wasm
export PDFium_SOURCE_DIR="$PWD/pdfium" PDFium_BUILD_DIR="$PWD/pdfium/out"
gclient config --unmanaged https://pdfium.googlesource.com/pdfium.git --custom-var checkout_configuration=minimal
printf "target_os = [ 'emscripten' ]\n" >> .gclient
gclient sync -r "pdfium@$PDFIUM_REVISION" --no-history --shallow
[[ $(git -C pdfium rev-parse HEAD) == "$PDFIUM_REVISION" ]]
# The pinned Chromium revision needs an updated form of the builder clang runtime patch.
cp "$repo/scripts/pdfium/clang-rt-8078.patch" patches/clang_rt.patch
# Fail if patches no longer apply, rather than silently falling back to upstream.
bash -eu steps/03-patch.sh
clone_revision https://github.com/emscripten-core/emsdk.git pdfium/third_party/emsdk "$EMSDK_REVISION"
( cd pdfium/third_party/emsdk; ./emsdk install "$EMSDK_VERSION"; ./emsdk activate "$EMSDK_VERSION" )
export EM_CONFIG="$PWD/pdfium/third_party/emsdk/.emscripten"
export PATH="$PWD/pdfium/buildtools/linux64:$PWD/pdfium/third_party/emsdk/upstream/emscripten:$PWD/pdfium/third_party/emsdk/upstream/bin:$PATH"
bash -eu steps/05-configure.sh
bash -eu steps/06-build.sh
cmp "$PDFium_SOURCE_DIR/public/fpdf_raw.h" "$repo/packages/engine/assets/fpdf_raw.h"
node "$repo/scripts/pdfium/verify-wasm.mjs" "$PDFium_BUILD_DIR/pdfium.wasm" "$repo/packages/engine/assets/pdfium.wasm" "$repo/packages/engine/assets/fpdf_raw.h" "$repo/packages/engine/assets/pdfium_worker.js"
printf 'Built %s\n' "$PDFium_BUILD_DIR/pdfium.wasm"
sha256sum "$PDFium_BUILD_DIR/pdfium.wasm"
printf 'Review and test before copying the WASM into packages/engine/assets/.\n'
