#!/bin/bash

if [ ! -d emsdk ]; then
    git clone https://github.com/emscripten-core/emsdk.git emsdk
fi

pushd emsdk

./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh

popd

pushd spirv-tools
git checkout vulkan-sdk-1.3.290.0

python3 utils/git-sync-deps
./source/wasm/build.sh

cp out/web/spirv-tools.wasm ../
cp out/web/spirv-tools.js ../
cp out/web/spirv-tools.d.ts ../

popd
