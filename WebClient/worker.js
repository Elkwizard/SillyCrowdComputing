(async () => {
	let answer;
	
	const wasm = WebAssembly.instantiateStreaming(fetch("./mine.wasm"), {
		env: {
			reportAnswer(x, y, z) {
				answer = `${x},${y},${z}`;
			}
		},
		wasi_snapshot_preview1: { }
	});

	addEventListener("message", async ({ data: { minX, minY, maxX, maxY } }) => {
		const { exports } = (await wasm).instance;

		try {
			answer = "";
			exports.searchRegion(
				BigInt(minX), BigInt(minY),
				BigInt(maxX), BigInt(maxY)
			);
			postMessage(answer);
		} catch (err) {
			postMessage(err);
		}
	});
	
})();