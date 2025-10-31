import http from "node:http";
import fs from "node:fs";
import child_process from "node:child_process";
import { styleText } from "node:util";

const generateColor = () => {
	return "#" + new Array(6)
		.fill()
		.map(() => Math.floor(Math.random() * 16).toString(16))
		.join("");
};

let userColor;
if (fs.existsSync("color.txt")) {
	userColor = fs.readFileSync("color.txt", "utf-8");
} else {
	userColor = generateColor();
	fs.writeFileSync("color.txt", userColor, "utf-8");
}

const [,, host] = process.argv;

const getNewChunk = async () => {
	const response = await new Promise((resolve, reject) => {
		http.get(`${host}/question`, res => {
			if (res.statusCode !== 200) reject(res.statusCode);

			let data = "";
			res.on("data", chunk => data += chunk);
			res.on("end", () => {
				resolve(data);
			});
		});
	});
	return JSON.parse(response);
};

const sendResult = async (result, minerID) => {
	while (true) {
		try {
			await new Promise((resolve, reject) => {
				const url = `${host}/answer?${new URLSearchParams({
					minerID,
					user: userColor
				})}`;
				const req = http.request(url, { method: "POST" }, res => {
					if (res.statusCode !== 200) reject(new Error(`Bad status code: ${res.statusCode} (${res.statusMessage})`));
					resolve();
				});
				req.on("error", reject);
				req.end(JSON.stringify(result));
			});
			return;
		} catch (err) {
			if (err.code !== "ECONNRESET") {
				console.error(styleText("red", err.stack));
			}
		}
	}
};

console.log("Color:", userColor);

while (true) {
	const { chunk, minerID } = await getNewChunk();
	console.log("Processing", chunk);
	const { x, y, width, height } = chunk;
	const answer = child_process.execSync(`"./mine.exe" ${x} ${y} ${width} ${height}`).toString();
	console.log("Sending Result", { answer });
	await sendResult(answer, minerID);
	console.log("Done");
}