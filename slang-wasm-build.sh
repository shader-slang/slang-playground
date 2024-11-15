#!/bin/bash

sudo apt-get install -y ninja-build

if [ ! -d emsdk ]; then
    git clone https://github.com/emscripten-core/emsdk.git
fi

pushd emsdk

./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh

popd

# slang-repo was created in previous step
pushd ./slang-repo

# slang was created in previous step
pushd slang
git submodule update --init --recursive

cmake --workflow --preset generators --fresh
mkdir generators
cmake --install build --prefix generators --component generators

emcmake cmake -DSLANG_GENERATORS_PATH=generators/bin --preset emscripten -DSLANG_SLANG_LLVM_FLAVOR=DISABLE
cmake --build --preset emscripten --target slang-wasm

cmakeRet=$?
popd

popd

if [ $cmakeRet -ne 0 ]; then
    exit -1;
fi

cp slang-repo/slang/build.em/Release/bin/* ./
cp slang-repo/slang/build.em/Release/bin/* ./
gzip -c slang-wasm.wasm > slang-wasm.wasm.gz

rm key.txt
echo "$(git -C ./slang-repo/slang rev-parse HEAD)" >> key.txt

echo "key: $(cat key.txt)"
