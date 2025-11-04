import { styleText } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import Server from "./server.mjs";
import serializeChunks from "./serialize.mjs";
import MIMES from "./mimes.mjs";

// change to proper directory
process.chdir(path.dirname(fileURLToPath(import.meta.url)));

console.log(`Switched to ${process.cwd()}`);

// setup & constants
process.loadEnvFile();
const CHUNK_SIZE = 35000;
const MAX_TIMEOUT = 15 * 60 * 1000; // milliseconds
const CACHE_DURATION = 60 * 60; // seconds
const CHUNKS_PATH = "./chunks.json";
const WEB_CLIENT_ROOT = "../WebClient";
const WEB_CLIENT_FILES = new Set([
	"index.html", "index.js", "worker.js",
	"mine.wasm", "favicon.png", "index.css",
	"puzzle.jpg"
]);

// helpers
const logError = err => console.error(styleText("red", err));

// main logic & server
const state = JSON.parse(fs.readFileSync(CHUNKS_PATH, "utf-8"));
const inProgress = new Map();

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

const server = new Server({
	protocol: process.env.PROTOCOL,
	hostname: process.env.HOST,
	port: +process.env.PORT
});
server.on("error", err => logError(err.stack));
server.on("close", async () => {
	for (const { chunk } of inProgress.values())
		state.unexplored.push(chunk);
	await writeState();

	console.log("Closed");
	process.exit(0);
});

server.route("GET", "/question", async writeResponse => {
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

server.route("POST", "/answer", async (writeResponse, { searchParams }, req) => {
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

server.route("GET", "/chunksize", async writeResponse => {
	await writeResponse(JSON.stringify(CHUNK_SIZE));
});

server.route("GET", "/explored", async (writeResponse, { searchParams }) => {
	const user = searchParams.get("user");
	await writeResponse(serializeChunks(state.explored, user));
});

server.route("GET", "/exploredafter", async (writeResponse, { searchParams }) => {
	const user = searchParams.get("user");
	const lastX = +searchParams.get("x");
	const lastY = +searchParams.get("y");

	if (isNaN(lastX) || isNaN(lastY)) {
		await writeResponse("Invalid x and/or y", 400);
		return;
	}

	const after = state.explored.filter(({ chunk: [x, y] }) => x > lastX || (x === lastX && y > lastY));
	await writeResponse(serializeChunks(after, user), 200);
});

const MATCH_COMPUTE = /\/(compute(\/(\w+\.\w+)?)?)?/;

server.route("GET", MATCH_COMPUTE, async (writeResponse, url) => {
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

	await writeResponse(result, 200, {
		"content-type": mimeType,
		"cache-control": `max-age=${CACHE_DURATION}`
	});
});

await server.open();
console.log(`Opened server at ${server.url}`);

process.on("SIGINT", () => server.close());