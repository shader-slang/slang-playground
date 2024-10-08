# Development instructions

## Setup

### Development environment shell

On Windows, set up the environment as follows:

    set TRY_SLANG_SOURCE_DIRECTORY_PATH=%userprofile%\source\try-slang
    set TRY_SLANG_TARGET_DIRECTORY_PATH=%userprofile%\target\try-slang

In the following, it is also assumed that GNU Make and Python are in PATH.

### Slang

`external/slang-wasm.js` and `external/slang-wasm.wasm` are built from the Slang repository, using the `slang-wasm` target.
If you want to build these yourself, follow the instructions in `docs/building.md` in the Slang repository.

### Server

The Wasm loader needs a running web server in the build target directory, in order to load .wasm files.

**NOTE: ** You do not need a shell with the full development environment set up, you just need Python and the `TRY_SLANG_TARGET_DIRECTORY_PATH` environment variable.

To start the server, run something like:

    $ cd $TRY_SLANG_TARGET_DIRECTORY_PATH && python -m http.server 8000

## Iterate

To iterate on the website, make changes and build the `website_runtime` target, from a development environment shell:

    $ make -f $TRY_SLANG_SOURCE_DIRECTORY_PATH/build.md website_runtime

Now load or reload `localhost:8000` in your browser to see the results.