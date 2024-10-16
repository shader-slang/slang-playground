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
	COPY = cp
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

ifneq ($(OS_NAME),Windows)
website_runtime: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/test
endif

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

ifneq ($(OS_NAME),Windows)
$(TRY_SLANG_SOURCE_DIRECTORY_PATH)/test: $(TRY_SLANG_TARGET_DIRECTORY_PATH)/test.o $(TRY_SLANG_TARGET_DIRECTORY_PATH)/slang-wgsl-cpp.o
	g++ -g $^ -o $@ -L $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build/Debug/lib/ -lslang -Wl,-rpath $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build/Debug/lib/
endif
