# Helper to ensure all required variables are defined
define ensure_defined

ifndef $1
  $$(error "$1 is not defined")
endif

endef

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
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)\index.html
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)\slang-wasm.js
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)\slang-wasm.wasm
website_runtime: $(TRY_SLANG_TARGET_DIRECTORY_PATH)\try-slang.js

$(TRY_SLANG_TARGET_DIRECTORY_PATH)\slang-wasm.js: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)\external\slang-wasm.js
	copy /b /y $(TRY_SLANG_SOURCE_DIRECTORY_PATH)\external\slang-wasm.js $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)\slang-wasm.wasm: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)\external\slang-wasm.wasm
	copy /b /y $(TRY_SLANG_SOURCE_DIRECTORY_PATH)\external\slang-wasm.wasm $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)\index.html: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)\index.html
	copy /b /y $(TRY_SLANG_SOURCE_DIRECTORY_PATH)\index.html $@

$(TRY_SLANG_TARGET_DIRECTORY_PATH)\try-slang.js: $(TRY_SLANG_SOURCE_DIRECTORY_PATH)\try-slang.js
	copy /b /y $(TRY_SLANG_SOURCE_DIRECTORY_PATH)\try-slang.js $@
