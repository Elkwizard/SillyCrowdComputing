const UPDATE_DELAY = 30000;

const threads = new Array(navigator.hardwareConcurrency)
	.fill()
	.map(() => new Worker("./worker.js"));

const $ = document.getElementById.bind(document);

class API {
	static async fetch(endpoint, params = { }, options) {
		return fetch(`${endpoint}?${new URLSearchParams(params)}`, options);
	}
	static async fetchJSON(...args) {
		return (await API.fetch(...args)).json();
	}
	static async getNewChunk() {
		const response = await fetch("/question");
		if (response.status !== 200)
			throw new Error(`Bad Status Code: ${response.status} (${response.statusText})`);
		return response.json();
	}
	static async getExplored() {
		if (!this.explored?.length) {
			this.explored = await API.fetchJSON("/explored", { user: userColor });
		} else {
			const grid = [];
			for (const { chunk: [x, y] } of this.explored)
				(grid[x] ??= [])[y] = true;
			
			let x = 0;
			let y = 0;
			for (let i = 0; i < this.explored.length; i++) {
				let nextX = x;
				let nextY = y;
				
				nextY++;
				if (nextY >= nextX) {
					nextY = 0;
					nextX++;
				}

				if (!grid[nextX]?.[nextY])
					break;
				
				x = nextX;
				y = nextY;
			}
			
			const newChunks = await API.fetchJSON("/exploredafter", { x, y, user: userColor });
			for (const chunk of newChunks) {
				const [x, y] = chunk.chunk;
				if (!grid[x]?.[y]) this.explored.push(chunk);
			}
		}

		return this.explored;
	}
	static async sendResult(result, minerID) {
		await API.fetch("/answer", { minerID, user: userColor }, {
			method: "POST",
			body: JSON.stringify(result)
		});
	}
}

const solveChunk = async (chunk, utilization) => {
	console.log("start", chunk);

	const threadCount = Math.max(1, Math.min(
		threads.length, Math.round(utilization * threads.length)
	));

	const minX = Math.max(chunk.x, 1);
	const minY = Math.max(chunk.y, 1);
	const maxX = chunk.x + chunk.width - 1;
	const maxY = chunk.y + chunk.height - 1;

	const sectionWidth = Math.ceil((maxX - minY) / threadCount);

	const promises = [];

	for (let i = 0; i < threadCount; i++) {
		const x = minX + sectionWidth * i;
		const thread = threads[i];
		thread.postMessage({
			minX: x,
			maxX: x + sectionWidth - 1,
			minY, maxY
		});
		promises.push(new Promise((resolve, reject) => {
			thread.addEventListener("message", ({ data }) => {
				if (data instanceof Error) {
					reject(data);
				} else {
					resolve(data);
				} 
			}, { once: true });
		}));
	}
	
	const answers = await Promise.all(promises);
	console.log("end", chunk, answers);
	return answers.find(Boolean) ?? "";
};

const formatNum = num => {
	if (num < 1e6) return num.toLocaleString();
	
	const SUFFIXES = ["", "Million", "Billion", "Trillion", "Quadrillion"];
	let index = -1;
	while (num > 1000) {
		num /= 1000;
		index++;
	}
	return `${num.toFixed(2)} ${SUFFIXES[index]}`;
};

const updateView = async () => {
	const explored = await API.getExplored();
	
	const shown = [...explored];
	if (currentChunk) shown.push({
		chunk: currentChunk,
		out: "",
		user: userColor,
		progress: true
	});
	const width = 1 + Math.max(0, ...shown.map(record => record.chunk[0]));
	const height = 1 + Math.max(0, ...shown.map(record => record.chunk[1]));
	
	const view = $("view");
	view.style.gridTemplateRows = `repeat(${height}, 1fr)`;
	view.style.gridTemplateColumns = `repeat(${width}, 1fr)`;

	view.innerHTML = "";
	for (const { chunk: [x, y], user, progress, out } of shown) {
		const tile = document.createElement("div");
		tile.className = "tile";
		if (progress) tile.classList.add("progress");
		tile.style.gridColumn = `${x + 1}`;
		tile.style.gridRow = `${height - y}`;
		if (user) {
			tile.style.color = user;
		} else {
			tile.classList.add("unknown");
		}

		if (out) tile.classList.add("success");

		view.appendChild(tile);
	}

	{
		const amount = explored.length;
		const yourChunks = explored.filter(chunk => chunk.user === userColor).length;
		const userCount = new Set(explored.map(chunk => chunk.user)).size;
		const yourPercent = yourChunks / amount * 100;
		const yourPercentStr = yourPercent < 1 ? "<1" : Math.round(yourPercent);
		const stats = [
			`${formatNum(amount)} Chunks Explored, ${yourChunks} by you (${yourPercentStr}%)`,
			`${formatNum(amount * 5000 ** 2)} Values Checked!`,
			`${userCount} Users`
		];
		$("progress").innerText = stats.join("\n");
		document.title = `Save the World! (${amount})`;
	}
};

const generateColor = () => {
	return "#" + new Array(6)
		.fill()
		.map(() => Math.floor(Math.random() * 16).toString(16))
		.join("");
};

const userColor = localStorage.userColor ??= generateColor();
let currentChunk = null;
let computing = false;

const showError = err => {
	document.title = "ERROR ):";
	$("errorStack").innerText = `${err.stack}`;
	$("error").style.display = "block";
};

const setComputeState = newComputing => {
	computing = newComputing;
	$("start").disabled = computing;
	$("stop").disabled = !computing;
	if (!computing) currentChunk = null;
};

const getUtilization = () => $("utilizationInput").value / threads.length;

addEventListener("load", async () => {
	try {
		for (const tile of document.getElementsByClassName("userColor"))
			tile.style.color = userColor;
		$("offer").dataset.userColor = userColor;
		await updateView();
	
		$("start").addEventListener("click", () => setComputeState(true));
		$("stop").addEventListener("click", () => setComputeState(false));
		$("offer").addEventListener("click", () => $("offer").toggleAttribute("data-verbose"));
		$("utilizationInput").addEventListener("input", event => {
			$("utilization").textContent = Math.round(getUtilization() * 100);
			localStorage.userUtilization = event.target.value;
		});
		$("utilizationInput").setAttribute("min", 0);
		$("utilizationInput").setAttribute("max", threads.length);
		$("utilizationInput").value = localStorage.userUtilization ?? threads.length;
		setComputeState(false);
		
		const compute = async () => {
			try {
				const utilization = getUtilization();
				if (computing && utilization > 0) {
					const { chunk, minerID } = await API.getNewChunk();
					currentChunk = [chunk.x / chunk.width, chunk.y / chunk.height];
					await updateView();
					const answer = await solveChunk(chunk, utilization);
					await API.sendResult(answer, minerID);
					await updateView();
				}
				setTimeout(compute, 100);
			} catch (err) {
				showError(err);
			}
		};

		compute();
		
		const viewId = setInterval(async () => {
			if (!computing && document.visibilityState === "visible") {
				try {
					await updateView();
				} catch (err) {
					clearInterval(viewId);
					showError(err);
				}
			}
		}, UPDATE_DELAY);
	} catch (err) {
		showError(err);
	}
});