const UPDATE_DELAY = 30000;

const $ = document.getElementById.bind(document);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");
const toggle = el => el.classList.toggle("hidden");

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

const generateColor = () => {
	return "#" + new Array(6)
		.fill()
		.map(() => Math.floor(Math.random() * 16).toString(16))
		.join("");
};

const user = {
	color: localStorage.userColor ??= generateColor(),
	currentChunk: null,
	computing: false
};

class Solver {
	constructor() {
		this.threads = new Array(navigator.hardwareConcurrency)
			.fill()
			.map(() => new Worker("./worker.js"));
	}
	get concurrency() {
		return this.threads.length;
	}
	async solveChunk(chunk, utilization) {
		const { threads } = this;
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
	}
}

class API {
	static async fetch(endpoint, params = {}, options) {
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
			this.explored = await API.fetchJSON("/explored", { user: user.color });
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

			const newChunks = await API.fetchJSON("/exploredafter", { x, y, user: user.color });
			for (const chunk of newChunks) {
				const [x, y] = chunk.chunk;
				if (!grid[x]?.[y]) this.explored.push(chunk);
			}
		}

		return this.explored;
	}
	static async sendResult(result, minerID) {
		await API.fetch("/answer", { minerID, user: user.color }, {
			method: "POST",
			body: JSON.stringify(result)
		});
	}
}

const getUserStats = (user, explored) => {
	const amount = explored.filter(chunk => chunk.user === user).length;
	const percent = amount / explored.length * 100;
	return {
		amount,
		percent: percent < 1 ? "<1%" : `${Math.round(percent)}%`
	};
};

class Grid {
	static DEFAULT_LW = 50;
	static PROGRESS_LW = 200;
	static ARROW_LW = 4;
	static MESSAGE_X = 0.35
	static MESSAGE_Y = 0.25;
	static MESSAGE_SIZE = 0.03;
	static MESSAGE_FONT = "Comic Neue";
	static HIGHLIGHT_COLOR = "yellow";
	static MESSAGE = "You're working on this one!";
	static FOUND_COLORS = ["red", "orange", "yellow", "green", "blue", "purple"];

	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = this.canvas.getContext("2d");
		this.explored = [];

		addEventListener("pointerup", this.handleMouse.bind(this));
		addEventListener("pointerdown", this.handleMouse.bind(this));
		addEventListener("pointermove", this.handleMouse.bind(this));
	}
	get rainbow() {
		const gradient = ctx.createLinearGradient(
			cx, cy, cx + chunkWidth, cy + chunkHeight
		);
		for (let i = 0; i < FOUND_COLORS.length; i++) {
			gradient.addColorStop(
				i / FOUND_COLORS.length,
				FOUND_COLORS[i]
			);
		}
		return gradient;
	}
	get lwScale() {
		return 1 / Math.max(this.columns, this.rows);
	}
	get progressLW() {
		return Grid.PROGRESS_LW * this.lwScale;
	}
	get defaultLW() {
		return Grid.DEFAULT_LW * this.lwScale;
	}
	get arrowLW() {
		return Grid.ARROW_LW;
	}
	handleMouse(event) {
		const user = this.getChunk(event.clientX, event.clientY);
		const statWrapper = $("hoverStats")
		statWrapper.style.display = user ? "block" : "none";
		if (user) {
			const stats = getUserStats(user, this.explored);;
			const amount = stats.percent === "<1%" ? stats.amount : stats.percent;
			statWrapper.textContent = `${user} (${amount})`;
			statWrapper.style.left = event.clientX + "px";
			statWrapper.style.top = event.clientY + "px";
			const { x, width } = statWrapper.getBoundingClientRect();
			statWrapper.style.left = Math.min(x, innerWidth - width) + "px";
		}
	}
	getChunk(px, py) {
		if (!this.grid) return null;

		const { x, y, width, height } = this.canvas.getBoundingClientRect();
		const cellX = Math.floor((px - x) / (width / this.columns));
		const cellY = Math.floor((py - y) / (height / this.rows));
		return this.grid[cellX]?.[this.rows - cellY - 1];
	}
	update(explored) {
		this.explored = [...explored];
		this.shown = [...this.explored];
		if (user.currentChunk) this.shown.push({
			chunk: user.currentChunk,
			color: user.color,
			progress: true,
			out: ""
		});
		this.grid = [];
		for (const { chunk: [x, y], user } of this.shown)
			(this.grid[x] ??= [])[y] = user;
		
		this.draw();
	}
	resize() {
		const { canvas, ctx } = this;
		const { width, height } = canvas.getBoundingClientRect();

		this.width = width;
		this.height = height;

		const pixelWidth = Math.floor(devicePixelRatio * width);
		const pixelHeight = Math.floor(devicePixelRatio * height);

		if (pixelWidth !== canvas.width || pixelHeight !== canvas.height) {
			canvas.width = pixelWidth;
			canvas.height = pixelHeight;
			ctx.scale(devicePixelRatio, devicePixelRatio);
		}

		ctx.clearRect(0, 0, width, height);

		this.columns = 1 + Math.max(0, ...this.shown.map(record => record.chunk[0]));
		this.rows = 1 + Math.max(0, ...this.shown.map(record => record.chunk[1]));

		this.chunkWidth = width / this.columns;
		this.chunkHeight = height / this.rows;
	}
	draw() {
		this.resize();
		const { ctx } = this;
		const { chunkWidth, chunkHeight } = this;

		ctx.strokeStyle = "black";
		ctx.lineWidth = this.defaultLW;

		const grid = [];
		for (const { chunk: [x, y], user, progress, out } of this.shown) {
			(grid[x] ??= [])[y] = user;

			const cx = x * chunkWidth;
			const cy = (this.rows - y - 1) * chunkHeight;

			ctx.fillStyle = out ? this.rainbow : user;
			ctx.fillRect(cx, cy, chunkWidth, chunkHeight);

			if (progress) {
				this.drawSignificance(cx, cy);
			} else {
				ctx.strokeRect(cx, cy, chunkWidth, chunkHeight);
			}
		}
	}
	drawSignificance(cx, cy) {
		const {
			ctx, width, height,
			chunkWidth, chunkHeight,
			progressLW, defaultLW, arrowLW
		} = this;

		const messageSize = Grid.MESSAGE_SIZE * height;
		const messageX = Grid.MESSAGE_X * width;
		const messageY = Grid.MESSAGE_Y * height;

		ctx.strokeStyle = "black";
		ctx.lineWidth = progressLW;
		const x = cx + progressLW / 2;
		const y = cy + progressLW / 2;
		const w = chunkWidth - progressLW;
		const h = chunkHeight - progressLW;

		ctx.strokeRect(x, y, w, h);

		ctx.strokeStyle = Grid.HIGHLIGHT_COLOR;
		ctx.lineWidth = progressLW / 2;
		ctx.strokeRect(x, y, w, h);

		ctx.strokeStyle = "black";
		ctx.lineWidth = arrowLW;
		const mx = messageX;
		const my = messageY;
		const cpx = width;
		const cpy = 0;
		ctx.beginPath();
		ctx.moveTo(mx + messageSize / 2, my);
		ctx.bezierCurveTo(cpx, cpy, cpx, cpy, x + w / 2, y + h / 2);
		ctx.stroke();

		ctx.font = `${messageSize}px ${Grid.MESSAGE_FONT}`;
		ctx.textBaseline = "middle";
		ctx.textAlign = "right";
		ctx.fillStyle = "black";
		ctx.fillText(
			Grid.MESSAGE,
			mx, my
		);

		ctx.strokeStyle = "black";
		ctx.lineWidth = defaultLW;
	}
}

const updateStats = explored => {
	const amount = explored.length;
	const userCount = new Set(explored.map(chunk => chunk.user)).size;
	const yours = getUserStats(user.color, explored);
	const stats = [
		`${formatNum(amount)} Chunks Explored, ${yours.amount} by you (${yours.percent})`,
		`${formatNum(amount * 5000 ** 2)} Values Checked!`,
		`${userCount} Users`
	];
	$("progress").innerText = stats.join("\n");
	document.title = `Save the World! (${formatNum(amount)})`;
};

const showError = err => {
	document.title = "ERROR ):";
	$("errorStack").innerText = `${err.stack}`;
	$("error").style.display = "block";
};

const handleMouse = event => {
	const previous = document.getElementsByClassName("hovered")[0];
	if (previous) previous.classList.remove("hovered");
	event.target.classList.add("hovered");
};

addEventListener("load", async () => {
	try {
		for (const tile of document.getElementsByClassName("userColor")) {
			tile.style.color = user.color;
			tile.dataset.info = user.color;
		}

		$("offer").dataset.userColor = user.color;

		// compute toggling
		const syncToggleEnable = () => {
			$("start").disabled = user.computing;
			$("stop").disabled = !user.computing;
		};
		$("start").addEventListener("click", () => {
			user.computing = true;
			syncToggleEnable();
		});
		$("stop").addEventListener("click", () => {
			user.computing = false;
			user.currentChunk = null;
			syncToggleEnable();
		});

		// details
		$("viewDetails").addEventListener("click", () => toggle($("details")));
		$("closeDetails").addEventListener("click", () => hide($("details")));
		$("blurOverlay").addEventListener("click", () => hide($("details")));
		addEventListener("keydown", event => {
			if (event.key === "Escape") hide($("details"));
		});
		if (!localStorage.shownDetails) {
			localStorage.shownDetails = "true";
			show($("details"));
		}

		const solver = new Solver();
		const grid = new Grid($("view"));

		// utilization
		const getUtilization = () => $("utilizationInput").value / solver.concurrency;
		$("utilizationInput").addEventListener("input", event => {
			$("utilization").textContent = Math.round(getUtilization() * 100);
			localStorage.userUtilization = event.target.value;
		});
		$("utilizationInput").setAttribute("min", 0);
		$("utilizationInput").setAttribute("max", solver.concurrency);
		$("utilizationInput").value = localStorage.userUtilization ?? solver.concurrency;

		// hover events
		addEventListener("pointerup", handleMouse);
		addEventListener("pointerdown", handleMouse);
		addEventListener("pointermove", handleMouse);

		// view and main loop
		const updateView = async () => {
			const explored = await API.getExplored();
			grid.update(explored);
			updateStats(explored);
		};

		await updateView();

		const compute = async () => {
			try {
				const utilization = getUtilization();
				if (user.computing && utilization > 0) {
					const { chunk, minerID } = await API.getNewChunk();
					user.currentChunk = [chunk.x / chunk.width, chunk.y / chunk.height];
					await updateView();
					const answer = await solver.solveChunk(chunk, utilization);
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
			if (!user.computing && document.visibilityState === "visible") {
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