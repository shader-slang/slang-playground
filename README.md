# Development instructions

## Setup

### Prerequisites

* Install [Docker](https://www.docker.com/get-started/)
* Install [Github CLI](https://cli.github.com/)
* install [Github Act](https://github.com/nektos/gh-act) as an extension using `gh extension install https://github.com/nektos/gh-act`

### Building

* Run `gh act -P ubuntu-latest=catthehacker/ubuntu:full-latest -j 'build' --artifact-server-path ./out`
* This will create a file at `out/1/artifact/artifact.zip`
* Extracting the zip file will provide a directory from which you can host the website

### Server

The Wasm loader needs a running web server in the build target directory, in order to load .wasm files.

**NOTE: ** You do not need a shell with the full development environment set up, you just need Python and the `TRY_SLANG_TARGET_DIRECTORY_PATH` environment variable.

To start the server, run something like:

    $ cd $TRY_SLANG_TARGET_DIRECTORY_PATH && python -m http.server 8000

## Iterate

In order to avoid the expensive build process, copy the following files from the output directory to the main directory:
* `slang-wasm.js`
* `slang-wasm.d.ts`
* `slang-wasm.wasm`
* `slang-wasm.wasm.gz`
* `spirv-tools.js`
* `spirv-tools.d.ts`

Run `npm install` to install dependencies.

You can then run `npx tsc` and host the webserver from the main directory. You will either need to run `npx tsc` whenever you make a code change, or you can run `npx tsc --watch` to continuously compile.

Now load or reload `localhost:8000` in your browser to see the results.