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

echo "if(EMSCRIPTEN)
    slang_add_target(
        .
        EXECUTABLE
        EXCLUDE_FROM_ALL
        USE_FEWER_WARNINGS
        LINK_WITH_PRIVATE
            miniz
            lz4_static
            slang
            core
            compiler-core
            slang-capability-defs
            slang-capability-lookup
            slang-reflect-headers
            slang-lookup-tables
        INCLUDE_DIRECTORIES_PUBLIC ${slang_SOURCE_DIR}/include .
    )
    # To generate binding code
    target_link_options(slang-wasm PUBLIC
        \"--bind\"
        --emit-tsd \"$<TARGET_FILE_DIR:slang-wasm>/slang-wasm.d.ts\"
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sEXTRA_EXPORTED_RUNTIME_METHODS=['FS']
    )
endif()" > "source/slang-wasm/CMakeLists.txt"

cmake --workflow --preset generators --fresh
mkdir generators
cmake --install build --prefix generators --component generators

emcmake cmake -DSLANG_GENERATORS_PATH=generators/bin --preset emscripten -DSLANG_SLANG_LLVM_FLAVOR=DISABLE -DSLANG_ENABLE_SPLIT_DEBUG_INFO=FALSE
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
