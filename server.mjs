import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import secret from "./secret.mjs";
import MIMES from "./mimes.mjs";

const CHUNK_SIZE = 5000;
const MAX_TIMEOUT = 5 * 60 * 1000;
const CHUNKS_PATH = "./chunks.json";
const HOST = "localhost";
const PORT = 8000;
const WEB_CLIENT_ROOT = "./WebClient";
const WEB_CLIENT_FILES = new Set([
	"index.html", "index.js", "worker.js",
	"mine.wasm", "favicon.png", "index.css"
]);

const logError = msg => console.error(`\x1b[31m${msg}\x1b[0m`);

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

const close = async () => {
	console.log("Authorized Closing");
	for (const { chunk } of inProgress.values())
		state.unexplored.push(chunk);

	await writeState();

	server.close();
	server.closeAllConnections();

	console.log("Closed");
	process.exit(0);
};

const routes = [];

/**
 * @param {string} method
 * @param {string | RegExp | (string) => boolean} matchPath
 * @param {(res: http.ServerResponse<http.IncomingMessage> & { req: http.IncomingMessage }, url?: URL, req?: http.IncomingMessage) => void} handle
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

route("GET", "/question", async res => {
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

	res.end(JSON.stringify(response));
});

route("POST", "/answer", async (res, { searchParams }, req) => {
	const user = searchParams.get("user");
	const minerID = searchParams.get("minerID");
	
	let data = "";
	req.on("data", chunk => data += chunk);
	await new Promise(resolve => req.on("end", resolve));
	const out = JSON.parse(data); // can fail

	if (!inProgress.has(minerID)) {
		console.log("From Inactive User", minerID);
		res.end();
		return;
	}

	console.log("From Active User", minerID);
	const { chunk, timerID } = inProgress.get(minerID);
	inProgress.delete(minerID);
	clearTimeout(timerID);

	console.log("Received Answer", { chunk, out, user });
	state.explored.push({ chunk, out, user });
	await writeState();
	res.end();
});

route("GET", "/close", async (res, { searchParams }) => {
	if (searchParams.get("secret") === secret) {
		res.end();
		await close();
	} else {
		console.log("Who do you think you are?");
		res.statusCode = 401;
		res.end();
	}
});

route("GET", "/explored", async res => {
	res.end(JSON.stringify(state.explored));
});

const MATCH_COMPUTE = /\/compute(\/(\w+\.\w+)?)?/;

route("GET", MATCH_COMPUTE, async (res, url) => {
	const [,, subfile = "index.html"] = url.pathname.match(MATCH_COMPUTE);
	if (!WEB_CLIENT_FILES.has(subfile)) {
		res.statusCode = 403;
		res.end();
		return;
	}

	const file = path.join(WEB_CLIENT_ROOT, subfile);
	const result = await fs.promises.readFile(file);
	const extension = path.extname(file);
	const mimeType = MIMES.get(extension);

	if (mimeType === undefined) {
		res.statusCode = 500;
		logError(`No MIME type for "${extension}"`);
		res.end();
	}

	res.setHeader("Content-Type", mimeType);
	res.end(result);
});

const server = http.createServer(async (req, res) => {
	if (!req.url.startsWith("/compute") && !req.url.startsWith("/explored"))
		console.log(`${req.method} ${req.url}`);

	try {
		res.setHeader("Access-Control-Allow-Origin", "*");
		const url = new URL(`http://localhost:${PORT}${req.url}`);
		for (const { method, matchPath, handle } of routes) {
			if (method === req.method && matchPath(url.pathname)) {
				await handle(res, url, req);
				return;
			}
		}

		res.statusCode = 400;
		res.end(`Unrecognized endpoint: ${req.method} ${req.url}`);
	} catch (err) {
		logError(err.stack);
		res.statusCode = 500;
		res.end();
	}
});

server.listen(PORT);
server.on("listening", () => {
	console.log(`Server started!`);
	console.log(`View at http://${HOST}:${PORT}/compute`);
});

process.stdin.on("data", buffer => {
	const string = buffer.toString().trim();
	if (string === "close") close();
});

process.on("SIGINT", () => close());