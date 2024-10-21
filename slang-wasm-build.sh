#!/bin/bash

sudo apt-get install -y ninja-build

# slang-repo was created in previous step
pushd ./slang-repo

git clone https://github.com/emscripten-core/emsdk.git

pushd emsdk

./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh

popd


# slang was created in previous step
pushd slang
git submodule update --init --recursive

cmake --workflow --preset generators --fresh
mkdir generators
cmake --install build --prefix generators --component generators

emcmake cmake -DSLANG_GENERATORS_PATH=generators/bin --preset emscripten -G "Ninja"
cmake --build --preset emscripten --target slang-wasm

popd


popd

cp slang-repo/slang/build.em/Release/bin/* ./
cp slang-repo/slang/build.em/Release/bin/* ./

rm key.txt
echo "$(git -C ./slang-repo/slang rev-parse HEAD)" >> key.txt

echo "key: $(cat key.txt)"

sudo rm -r slang-repo
