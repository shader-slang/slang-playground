# Development instructions

## Setup

### Prerequisites

* Install [Docker](https://www.docker.com/get-started/)
* Install [Github CLI](https://cli.github.com/)
* install [Github Act](https://github.com/nektos/gh-act) as an extension using `gh extension install https://github.com/nektos/gh-act`

### Building

* Run `gh act -P ubuntu-latest=catthehacker/ubuntu:full-latest -j 'build' --artifact-server-path ./out`
* This will create a file at `out/1/artifact/artifact.zip`

In the following, it is also assumed that GNU Make, Python and gzip are in PATH.
Follow the setup instructions in `docs/building.md` for building `slang-wasm` in the Slang repository.
(E.g. setup shell for CMake and Emscripten, and setup the `build.em` output directory.)

### Server

The Wasm loader needs a running web server in the build target directory, in order to load .wasm files.

**NOTE: ** You do not need a shell with the full development environment set up, you just need Python and the `TRY_SLANG_TARGET_DIRECTORY_PATH` environment variable.

To start the server, run something like:

    $ cd $TRY_SLANG_TARGET_DIRECTORY_PATH && python -m http.server 8000

## Iterate

To iterate on the website, make changes and build the `website_runtime` target, from a development environment shell:

    $ make -f $TRY_SLANG_SOURCE_DIRECTORY_PATH/build.md website_runtime

Now load or reload `localhost:8000` in your browser to see the results.