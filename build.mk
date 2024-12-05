# Helper to ensure all required variables are defined
define ensure_defined

ifndef $1
  $$(error "$1 is not defined")
endif

endef

define runtime_source_rule

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/$(1): $(TRY_SLANG_SOURCE_DIRECTORY_PATH)/$(1)
	$(call COPY,$(TRY_SLANG_SOURCE_DIRECTORY_PATH)/$(1),$(TRY_SLANG_TARGET_DIRECTORY_PATH)/$(1))

endef

OS_NAME :=
ifeq ($(OS),Windows_NT)
	OS_NAME = Windows
else
	OS_NAME = $(shell uname -s)
endif

COPY :=
ENSURE_DIR :=
ifeq ($(OS_NAME),Windows)
	CANONICAL_PATH = $(subst /,\,$(1))
	ENSURE_DIR = if not exist $(call CANONICAL_PATH,$(dir $1)) mkdir $(call CANONICAL_PATH,$(dir $1))
	COPY = ($(call ENSURE_DIR,$(2))) && copy /b /y "$(call CANONICAL_PATH,$(1))" "$(call CANONICAL_PATH,$(2))"
else
	CANONICAL_PATH = $(1)
	ENSURE_DIR = mkdir -p $(dir $1)
	COPY = $(call ENSURE_DIR,$(2)) && cp -rf $(1) $(2)
endif

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

website_source_files :=
website_source_files += compiler.js
website_source_files += compute.js
website_source_files += demos/atomics.slang
website_source_files += demos/autodiff.slang
website_source_files += demos/circle.slang
website_source_files += demos/demo-list.js
website_source_files += demos/entrypoint.slang
website_source_files += demos/generic.slang
website_source_files += demos/gsplat2d-diff.slang
website_source_files += demos/gsplat2d.slang
website_source_files += demos/image-from-url.slang
website_source_files += demos/multiple-kernels.slang
website_source_files += demos/ocean.slang
website_source_files += demos/operator-overload.slang
website_source_files += demos/property.slang
website_source_files += demos/rand_float.slang
website_source_files += demos/simple-image.slang
website_source_files += demos/simple-print.slang
website_source_files += demos/variadic.slang
website_source_files += index.html
website_source_files += language-server.js
website_source_files += pass_through.js
website_source_files += playgroundShader.js
website_source_files += static/jeep.jpg
website_source_files += static/slang-logo-1.png
website_source_files += static/slang-logo.svg
website_source_files += styles/styles.css
website_source_files += try-slang.js
website_source_files += ui.js
website_source_files += util.js

website_runtime_files :=
website_runtime_files += $(website_source_files)
website_runtime_files += slang-wasm.wasm.gz
website_runtime_files += slang-wasm.js

.PHONY: website_runtime
website_runtime: $(foreach p,$(website_runtime_files),$(TRY_SLANG_TARGET_DIRECTORY_PATH)/$(p))

.PHONY: $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.js
$(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.js $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.wasm &:
	cd $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH) && \
	 cmake --build --preset emscripten --target slang-wasm

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/slang-wasm.js: $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.js
	$(call COPY,$(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.js,$@)

$(TRY_SLANG_TARGET_DIRECTORY_PATH)/slang-wasm.wasm.gz: $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.wasm
	gzip -c $(TRY_SLANG_SLANG_SOURCE_DIRECTORY_PATH)/build.em/Release/bin/slang-wasm.wasm > $@

$(eval $(foreach p,$(website_source_files),$(call runtime_source_rule,$(p))))
