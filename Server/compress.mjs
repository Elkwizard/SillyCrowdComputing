import zlib from "node:zlib";
import { promisify } from "node:util";

const ENCODERS = new Map([
	["br", promisify(zlib.brotliCompress)],
	["deflate", promisify(zlib.deflateRaw)],
	["zstd", promisify(zlib.zstdCompress)],
	["gzip", promisify(zlib.gzip)]
]);

export default async (data, encodings) => {
	if (data !== null) {
		for (const encoding of encodings) {
			if (ENCODERS.has(encoding)) {
				const encoded = await ENCODERS.get(encoding)(data);
				return { encoding, encoded };
			}
		}
	}

	return { encoding: "", encoded: data };
};