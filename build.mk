# Helper to ensure all required variables are defined
define ensure_defined

ifndef $1
  $$(error "$1 is not defined")
endif

endef

OS_NAME :=
ifeq ($(OS),Windows_NT)
	OS_NAME = Windows
else
	OS_NAME = $(shell uname -s)
endif

COPY:=
ifeq ($(OS_NAME),Windows)
	COPY = copy /b /y
else
	COPY = cp -rf
endif

# Helper to ensure a directory exists
ensure_dir = if not exist $(dir $1) mkdir $(dir $1)

# Check that all required variables are defined
required_variables =
## The output directory where to output target (non-source) files
required_variables += TRY_SLANG_TARGET_DIRECTORY_PATH
## Path to the hello-emscripten source tree
required_variables += TRY_SLANG_SOURCE_DIRECTORY_PATH
## Slang source directory
required_variables += TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH
$(eval $(foreach var,$(required_variables),\
	$(call ensure_defined,$(var))))

.PHONY: website_runtime
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/index.html
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/slang-wasm.js
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/slang-wasm.wasm
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/try-slang.js
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/util.js
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/pass_through.js
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/compute.js
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/water_demo.js
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/ui.js
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/styles
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/compiler.js

.PHONY: $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.js
$(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.js $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.wasm &:
	cd $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH) && \
	 cmake --build --preset emscripten --target slang-wasm

.PHONY: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/slang-wasm.js
$(TRY_SLANG_TARGET_DIRECTORY_PATH)/slang-wasm.js: $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.js
	$(COPY) $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.js $@

.PHONY: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/slang-wasm.wasm
$(TRY_SLANG_TARGET_DIRECTORY_PATH)/slang-wasm.wasm: $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.wasm
	$(COPY) $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.wasm $@

.PHONY: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/index.html
$(TRY_SLANG_TARGET_DIRECTORY_PATH)/index.html: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/index.html
	$(COPY) $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/index.html $@

.PHONY: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/try-slang.js
$(TRY_SLANG_TARGET_DIRECTORY_PATH)/try-slang.js: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/try-slang.js
	$(COPY) $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/try-slang.js $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/util.js: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/util.js
	$(COPY) $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/util.js $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/pass_through.js: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/pass_through.js
	$(COPY) $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/pass_through.js $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/compute.js: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/compute.js
	$(COPY) $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/compute.js $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/water_demo.js: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/water_demo.js
	$(COPY) $^ $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/ui.js: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/ui.js
	$(COPY) $^ $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/styles: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/styles
	$(COPY) $^ $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/compiler.js: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/compiler.js
	$(COPY) $^ $@
