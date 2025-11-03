#include <cinttypes>
#include <cmath>
#include <tuple>
#include <limits>

void found(uint64_t x, uint64_t y, uint64_t z);

int64_t getSDF(uint64_t x, uint64_t y, uint64_t z) {
	uint64_t xy = x + y;
	uint64_t xz = x + z;
	uint64_t yz = y + z;
	return	x * xz * xy +
			y * yz * xy +
			z * yz * xz -
			4 * yz * xz * xy;
}

bool isCorrect(uint64_t x, uint64_t y, uint64_t z) {
	return getSDF(x, y, z) == 0;
}

void binarySearch(uint64_t x, uint64_t y, uint64_t lo, uint64_t hi) {
	while (lo <= hi) {
		uint64_t mid = lo + (hi - lo) / 2;
		int64_t diff = getSDF(x, y, mid);
		if (diff < 0) {
			lo = mid + 1;
		} else if (diff > 0) {
			hi = mid - 1;
		} else if (diff == 0) [[unlikely]] {
			found(x, y, mid);
		}
	}
}

std::tuple<uint64_t, uint64_t, uint64_t, uint64_t> clamp(
	uint64_t x, uint64_t y, uint64_t width, uint64_t height
) {
	uint64_t minX = std::max(1ull, x);
	uint64_t minY = std::max(1ull, y);
	uint64_t maxX = x + width - 1;
	uint64_t maxY = y + height - 1;
	return std::make_tuple(minX, minY, maxX, maxY);
}

void search(uint64_t minX, uint64_t minY, uint64_t maxX, uint64_t maxY) {
	for (uint64_t x = minX; x <= maxX; x++)
	for (uint64_t y = minY; y <= maxY; y++) {
		uint64_t startZ = std::floor((x + y) / 0.2685);
		uint64_t endZ = std::ceil((x + y) / 0.265);
		if (startZ < 1) startZ = 1;

		binarySearch(x, y, startZ, endZ);
	}
}