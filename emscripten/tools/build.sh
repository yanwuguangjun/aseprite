#!/usr/bin/env bash
# Build Aseprite WASM core and copy artifacts into web/public/aseprite
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="${ROOT}/build-wasm"
CONFIG="${1:-Release}"

if [[ -f /tmp/emsdk/emsdk_env.sh ]]; then
  # shellcheck disable=SC1091
  source /tmp/emsdk/emsdk_env.sh
elif [[ -f "${EMSDK}/emsdk_env.sh" ]]; then
  # shellcheck disable=SC1091
  source "${EMSDK}/emsdk_env.sh"
fi

if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake not found. Install/activate emsdk first." >&2
  exit 1
fi

# Ensure critical submodules exist
if [[ ! -f "${ROOT}/laf/CMakeLists.txt" ]]; then
  git -C "${ROOT}" submodule update --init --recursive
fi

mkdir -p "${BUILD_DIR}"
CMAKE_BUILD_TYPE="${CONFIG}"
if [[ "${CONFIG}" == "Debug" ]]; then
  EXTRA_FLAGS="-DCMAKE_BUILD_TYPE=Debug"
else
  EXTRA_FLAGS="-DCMAKE_BUILD_TYPE=Release"
fi

emcmake cmake -S "${ROOT}/emscripten" -B "${BUILD_DIR}" ${EXTRA_FLAGS}
cmake --build "${BUILD_DIR}" --parallel "$(nproc)"

echo "WASM artifacts:"
ls -lh "${ROOT}/web/public/aseprite/" || true
