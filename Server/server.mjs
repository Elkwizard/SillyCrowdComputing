import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import EventEmitter from "node:events";

import compress from "./compress.mjs";

export default class Server extends EventEmitter {
	constructor({ protocol, hostname, port}) {
		super();
		this.protocol = protocol;
		this.hostname = hostname;
		this.port = port;
		this.ongoingRequests = new Set();
		this.routes = [];
	}
	get url() {
		return `${this.protocol}://${this.hostname}:${this.port}`;
	}
	/**
	 * @param {string} method
	 * @param {string | RegExp | (string) => boolean} matchPath
	 * @param {(writeResponse: (data: string | Buffer | null, status: number, headers: http.OutgoingHttpHeaders) => Promise<void>, url?: URL, req?: http.IncomingMessage) => void} handle
	 */
	route(method, matchPath, handle) {
		if (typeof matchPath === "string") {
			const url = matchPath;
			matchPath = pathname => pathname === url;
		} else if (matchPath instanceof RegExp) {
			const regex = matchPath;
			matchPath = pathname => regex.test(pathname);
		}
		this.routes.push({ method, matchPath, handle });
	}
	async handleRequest(req, res) {
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
		this.ongoingRequests.add(promise);
	
		try {
			const url = new URL(this.url + req.url);
	
			console.log(`${req.method} ${url.pathname}`, Object.fromEntries(url.searchParams));
	
			for (const { method, matchPath, handle } of this.routes) {
				if (method === req.method && matchPath(url.pathname)) {
					await handle(writeResponse, url, req);
					return;
				}
			}
	
			await writeResponse(`Unrecognized endpoint: ${req.method} ${req.url}`, 400);
		} catch (err) {
			this.emit("error", err);
			res.statusCode = 500;
			res.end();
		} finally {
			this.ongoingRequests.delete(promise);
			resolve();
		}
	}
	async open() {
		const handleRequest = this.handleRequest.bind(this);
		this.server = this.protocol === "https" ? https.createServer({
			key: fs.readFileSync("ssl/privkey.pem"),
			cert: fs.readFileSync("ssl/cert.pem")
		}, handleRequest) : http.createServer(handleRequest);

		this.server.listen(this.port);

		await new Promise(resolve => this.server.on("listening", resolve));
	}
	async close() {
		console.log(`Authorized Closing, Waiting for ${this.ongoingRequests.size} Requests`);
		this.server.close();

		await Promise.all([...this.ongoingRequests]);
		console.log("All Requests Completed");
		this.server.closeAllConnections();

		this.emit("close");
	}
}