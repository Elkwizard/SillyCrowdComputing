import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { promisify, styleText } from "node:util";
import zlib from "node:zlib";
import secret from "./secret.mjs";
import MIMES from "./mimes.mjs";

process.loadEnvFile();

const CHUNK_SIZE = 5000;
const MAX_TIMEOUT = 5 * 60 * 1000;
const CHUNKS_PATH = "./chunks.json";
const HOST = process.env.HOST;
const PORT = +process.env.PORT;
const PROTOCOL = process.env.PROTOCOL;
const WEB_CLIENT_ROOT = "./WebClient";
const WEB_CLIENT_FILES = new Set([
	"index.html", "index.js", "worker.js",
	"mine.wasm", "favicon.png", "index.css"
]);
const ENCODERS = new Map([
	["br", promisify(zlib.brotliCompress)],
	["deflate", promisify(zlib.deflateRaw)],
	["zstd", promisify(zlib.zstdCompress)],
	["gzip", promisify(zlib.gzip)]
]);

const logError = msg => console.error(styleText("red", msg));
const compress = async (data, encodings) => {
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

const wiggleColors = (json, user) => {
	const wiggleMap = new Map();
	return json.replace(/#([0-9a-fA-F]{6})/g, (full, hex) => {
		if (full === user) return user;

		if (!wiggleMap.has(hex)) {
			const hash = crypto.hash("sha1", hex, "hex");
			const [ , b,  , d,  , f] = hash;
			const [a,  , c,  , e,  ] = hex;
			wiggleMap.set(hex, "#" + a + b + c + d + e + f);
		}
		return wiggleMap.get(hex);
	});
};

const state = JSON.parse(fs.readFileSync(CHUNKS_PATH, "utf-8"));

const writeState = async () => {
	await fs.promises.writeFile(CHUNKS_PATH, JSON.stringify(state), "utf-8");
	console.log("Wrote State");
};

const nextChunk = () => {
	if (state.unexplored.length)
		return state.unexplored.pop();
	
	const chunk = [state.nextX, state.nextY];

	state.nextY++;
	if (state.nextY > state.nextX) {
		state.nextX++;
		state.nextY = 0;
	}

	return chunk;
};

const inProgress = new Map();
const ongoingRequests = new Set();
const close = async () => {
	console.log(`Authorized Closing, Waiting for ${ongoingRequests.size} Requests`);
	server.close();

	await Promise.all([...ongoingRequests]);
	console.log("All Requests Completed");
	server.closeAllConnections();

	for (const { chunk } of inProgress.values())
		state.unexplored.push(chunk);
	await writeState();

	console.log("Closed");
	process.exit(0);
};

const routes = [];

/**
 * @param {string} method
 * @param {string | RegExp | (string) => boolean} matchPath
 * @param {(writeResponse: (data: string | Buffer | null, status: number, headers: http.OutgoingHttpHeaders) => Promise<void>, url?: URL, req?: http.IncomingMessage) => void} handle
 */
const route = (method, matchPath, handle) => {
	if (typeof matchPath === "string") {
		const url = matchPath;
		matchPath = pathname => pathname === url;
	} else if (matchPath instanceof RegExp) {
		const regex = matchPath;
		matchPath = pathname => regex.test(pathname);
	}
	routes.push({ method, matchPath, handle });
};

route("GET", "/question", async writeResponse => {
	const chunk = nextChunk();
	await writeState();
	const timerID = setTimeout(async () => {
		console.log("Deactivating User", minerID);
		const { chunk } = inProgress.get(minerID);
		state.unexplored.push(chunk);
		inProgress.delete(minerID);
		await writeState();
	}, MAX_TIMEOUT);
	
	const minerID = crypto.randomUUID();
	
	console.log(`Assigning Chunk`, minerID, chunk);
	
	inProgress.set(minerID, { chunk, timerID, minerID });

	const response = {
		chunk: {
			x: chunk[0] * CHUNK_SIZE,
			y: chunk[1] * CHUNK_SIZE,
			width: CHUNK_SIZE,
			height: CHUNK_SIZE
		},
		minerID
	};

	await writeResponse(JSON.stringify(response));
});

route("POST", "/answer", async (writeResponse, { searchParams }, req) => {
	const user = searchParams.get("user");
	const minerID = searchParams.get("minerID");
	
	let data = "";
	req.on("data", chunk => data += chunk);
	await new Promise(resolve => req.on("end", resolve));
	const out = JSON.parse(data); // can fail

	if (!inProgress.has(minerID)) {
		console.log("From Inactive User", minerID);
		await writeResponse(null, 400);
		return;
	}

	console.log("From Active User", minerID);
	const { chunk, timerID } = inProgress.get(minerID);
	inProgress.delete(minerID);
	clearTimeout(timerID);

	console.log("Received Answer", { chunk, out, user });
	state.explored.push({ chunk, out, user });
	await writeState();
	await writeResponse(null);
});

route("GET", "/close", async (writeResponse, { searchParams }) => {
	if (searchParams.get("secret") === secret) {
		await writeResponse(null);
		await close();
	} else {
		console.error("Who do you think you are?");
		await writeResponse(null, 401);
	}
});

route("GET", "/explored", async (writeResponse, { searchParams }) => {
	const user = searchParams.get("user");
	await writeResponse(wiggleColors(JSON.stringify(state.explored), user));
});

route("GET", "/exploredafter", async (writeResponse, { searchParams }) => {
	const user = searchParams.get("user");
	const lastX = +searchParams.get("x");
	const lastY = +searchParams.get("y");

	if (isNaN(lastX) || isNaN(lastY)) {
		await writeResponse("Invalid x and/or y", 400);
		return;
	}

	const after = state.explored.filter(({ chunk: [x, y] }) => x > lastX || (x === lastX && y > lastY));
	await writeResponse(wiggleColors(JSON.stringify(after), user), 200);
});

const MATCH_COMPUTE = /\/(compute(\/(\w+\.\w+)?)?)?/;

route("GET", MATCH_COMPUTE, async (writeResponse, url) => {
	const [,,, subfile = "index.html"] = url.pathname.match(MATCH_COMPUTE);
	if (!WEB_CLIENT_FILES.has(subfile)) {
		await writeResponse(null, 403);
		return;
	}

	const file = path.join(WEB_CLIENT_ROOT, subfile);
	const result = await fs.promises.readFile(file);
	const extension = path.extname(file);
	const mimeType = MIMES.get(extension);

	if (mimeType === undefined) {
		logError(`No MIME type for "${extension}"`);
		await writeResponse(null, 500);
	}

	await writeResponse(result, 200, { "content-type": mimeType });
});

const handleRequest = async (req, res) => {
	if (!req.url.startsWith("/compute"))
		console.log(`${req.method} ${req.url}`);

	const writeResponse = async (data, status = 200, headers = { }) => {
		const encodings = (req.headers["accept-encoding"] ?? "").split(", ");
		const { encoded, encoding } = await compress(data, encodings);
		res.writeHead(status, {
			...headers,
			"content-encoding": encoding,
			"access-control-allow-origin": "*"
		});
		res.end(encoded);
	};
	
	const { promise, resolve } = Promise.withResolvers();
	ongoingRequests.add(promise);

	try {
		const url = new URL(`${PROTOCOL}://${HOST}:${PORT}${req.url}`);
		for (const { method, matchPath, handle } of routes) {
			if (method === req.method && matchPath(url.pathname)) {
				await handle(writeResponse, url, req);
				return;
			}
		}

		await writeResponse(`Unrecognized endpoint: ${req.method} ${req.url}`, 400);
	} catch (err) {
		logError(err.stack);
		res.statusCode = 500;
		res.end();
	} finally {
		ongoingRequests.delete(promise);
		resolve();
	}
};

const server = PROTOCOL === "https" ? https.createServer({
	key: fs.readFileSync("ssl/privkey.pem"),
	cert: fs.readFileSync("ssl/cert.pem")
}, handleRequest) : http.createServer(handleRequest);

server.listen(PORT);
server.on("listening", () => {
	console.log(`Server started!`);
	console.log(`View at ${PROTOCOL}://${HOST}:${PORT}/`);
});

process.stdin.on("data", buffer => {
	const string = buffer.toString().trim();
	if (string === "close") close();
});

process.on("SIGINT", () => close());
