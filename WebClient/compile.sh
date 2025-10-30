source .env
originalPath="$(pwd)"
cd "$EMSDK_PATH"
source ./emsdk_env.sh
cd "$originalPath"

emcc \
	mine.cpp \
	-o mine.wasm \
	-Wall \
	-sSTANDALONE_WASM \
	-sWARN_ON_UNDEFINED_SYMBOLS=0 \
	-sALLOW_MEMORY_GROWTH=1 \
	--no-entry \
	-std=c++23 \
	-O3