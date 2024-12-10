# Development Instructions

## Setup

Clone the [Slang Playground](https://github.com/shader-slang/slang-playground):

```bash
git clone https://github.com/shader-slang/slang-playground.git
```

### Prerequisites

* Install [Docker](https://www.docker.com/get-started/)
* Install [Github CLI](https://cli.github.com/)
* install [Github Act](https://github.com/nektos/gh-act) as an extension using `gh extension install https://github.com/nektos/gh-act`

### Building

* Run `gh act -P ubuntu-latest=catthehacker/ubuntu:full-latest -j 'build' --artifact-server-path ./out`
* This will create a file at `out/1/artifact/artifact.zip`
* Extracting the zip file will provide a directory from which you can host the website

### Starting the Server

1. Navigate to the root of your webfiles (where `slang-wasm.js` and `slang-wasm.wasm.gz` are located) either in the artifact folder or the root of your playground directory.

   ```bash
   cd slang-playground
   ```

2. Start a Python web server to host the files:

   ```bash
   python serve.py
   ```

3. Open `http://localhost:8000` in your browser to verify the server is running and the files are accessible. You should see the application loading the `.wasm` and `.js` files correctly.

If any issues arise, ensure the `.wasm` file is properly compressed (`slang-wasm.wasm.gz`) and located in the correct directory.

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

When updating CSS or some transitively included files, the browser may use the out of date file stored in the cache. To prevent this, you can hold Shift key and click Refresh to force the browser to reload all files.