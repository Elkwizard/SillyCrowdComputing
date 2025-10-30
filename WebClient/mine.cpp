#include "../compute.cpp"

#ifdef __INTELLISENSE__
	#define EMSCRIPTEN_KEEPALIVE
#else
	#include "emscripten.h"
#endif

extern "C" void reportAnswer(uint64_t, uint64_t, uint64_t);

void found(uint64_t x, uint64_t y, uint64_t z) {
	reportAnswer(x, y, z);
}

EMSCRIPTEN_KEEPALIVE extern "C" void searchRegion(uint64_t minX, uint64_t minY, uint64_t maxX, uint64_t maxY) {
	search(minX, minY, maxX, maxY); 
}