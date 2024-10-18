#!/bin/bash

sudo apt-get install -y ninja-build

mkdir ./slang-repo
pushd ./slang-repo

git clone https://github.com/emscripten-core/emsdk.git

pushd emsdk

./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh

popd


git clone --recursive https://github.com/shader-slang/slang.git
pushd slang

cmake --workflow --preset generators --fresh
mkdir generators
cmake --install build --prefix generators --component generators

emcmake cmake -DSLANG_GENERATORS_PATH=generators/bin --preset emscripten -G "Ninja"
cmake --build --preset emscripten --target slang-wasm

popd


popd

cp slang-repo/slang/build.em/Release/bin/* ./

sudo rm -r slang-repo
