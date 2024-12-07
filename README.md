# Development Instructions

## Setup

Clone the [Slang Playground](https://github.com/shader-slang/slang-playground):

```bash
git clone https://github.com/shader-slang/slang-playground.git
```

### Prerequisites

Ensure the following tools are installed and properly configured on your system:
- **CMake** (Version 3.25 or greater is preferred, if you're on a lower version please see [build with older cmake](https://github.com/shader-slang/slang/blob/master/docs/building.md#building-with-an-older-cmake))
- A **C++ compiler** with C++17 support (GCC, Clang, or MSVC)
- A **CMake-compatible build backend** (e.g., Ninja or Visual Studio)
- **Python 3** (Required for building and running the server)
- **gzip** (For compressing `.wasm` files)

To install the above tools on linux, run:
```bash
sudo apt update
sudo apt install build-essential cmake ninja-build python3 python3-pip gzip
```

We need to build `slang-wasm` because we need `slang-wasm.js` and `slang-wasm.wasm` files.
The reason they're not included in this repo is that they are big binary files, and the result of building top of tree slang, so making this part of the CI build process makes the most sense.

### Building `slang-wasm`

1. Clone the [Slang repository](https://github.com/shader-slang/slang) and fetch its submodules:
   ```bash
   git clone https://github.com/shader-slang/slang --recursive

   cd slang
   ```

2. Follow the instructions in the [WebAssembly build section](https://github.com/shader-slang/slang/blob/master/docs/building.md#webassembly-build) of the Slang documentation to:
   - Set up the [Emscripten SDK](https://github.com/emscripten-core/emsdk) by installing and activating it.
   - Build the WebAssembly target (`slang-wasm.js` and `slang-wasm.wasm`) using the documented cross-compilation steps.

3. Once the build completes, locate `slang-wasm.js` and `slang-wasm.wasm` in the `build.em/Release/bin` directory
   
4. Copy `slang-wasm.js` and `slang-wasm.wasm` to the **root of the playground directory**.

5. Compress the `slang-wasm.wasm` file using gzip:
   ```bash
   gzip -k slang-wasm.wasm
   ```

### Building `spirv-tool`

To enable SPIR-V disassembly in the playground (alongside the SPIR-V binary compilation supported by `slang-wasm.js`), you need to build the WebAssembly version of `spirv-tool`. This is necessary because `slang-wasm.js` does not include the SPIR-V disassembler.

1. Refer to the build process outlined in the CI configuration:
   - [GitHub Workflow](https://github.com/shader-slang/slang-playground/blob/main/.github/workflows/jekyll-gh-pages.yml#L43)
   - [Build Script](https://github.com/shader-slang/slang-playground/blob/main/spirv-tool-wasm-build.sh)

2. Use the provided [`spirv-tool-wasm-build.sh`](https://github.com/shader-slang/slang-playground/blob/main/spirv-tool-wasm-build.sh) script to compile the WebAssembly build of `spirv-tool`.

3. Once built, place the resulting files (`spirv-tools.wasm` and `spirv-tools.js`) in the **root of the playground directory** alongside `slang-wasm.js` and `slang-wasm.wasm`.

By completing this step, the playground will support SPIR-V disassembly features.

### Starting the Server

1. Navigate to the root of your playground directory (where `slang-wasm.js` and `slang-wasm.wasm.gz` are located).
   ```bash
   cd slang-playground
   ```

2. Start a Python web server to host the files:
   ```bash
   python -m http.server 8000
   ```

3. Open `http://localhost:8000` in your browser to verify the server is running and the files are accessible. You should see the application loading the `.wasm` and `.js` files correctly.

If any issues arise, ensure the `.wasm` file is properly compressed (`slang-wasm.wasm.gz`) and located in the correct directory.

This process of: build -> run, should work alone.

## Iterating on Development Using build.mk

Alternatively you can build using the `build.mk` file.

Set up the environment as follows:

```bash
## The output directory where to output target (non-source) files
export TRY_SLANG_TARGET_DIRECTORY_PATH="path-to-slang-target-directory"
## Path to the hello-emscripten source tree
export TRY_SLANG_SOURCE_DIRECTORY_PATH="path-to-slang-source-directory"
## Slang source directory
export TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH="path-to-slang-directory"
```

1. Make the necessary changes to your source code.
2. Build the updated runtime by running:
   ```bash
   make -f ./build.mk website_runtime
   ```
3. Refresh `http://localhost:8000` in your browser to view the changes.