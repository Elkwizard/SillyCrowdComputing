#include <cinttypes>
#include <print>
#include <cmath>
#include <thread>
#include <vector>

#include "../compute.cpp"

void found(uint64_t x, uint64_t y, uint64_t z) {
	std::println("{},{},{}", x, y, z);
	exit(0);
}

int main(int argc, char** argv) {
	if (argc != 5) return 1;

	auto [minX, minY, maxX, maxY] = clamp(
		atoll(argv[1]), atoll(argv[2]),
		atoll(argv[3]), atoll(argv[4])
	);

	uint64_t chunk = std::max(1ull, (maxX - minX) / std::thread::hardware_concurrency());

	std::vector<std::thread> threads;

	for (uint64_t bx = minX; bx <= maxX; bx += chunk)
		threads.emplace_back([=]() {
			search(bx, minY, bx + chunk - 1, maxY);
		});

	for (std::thread& thread : threads)
		thread.join();

	return 0;
}