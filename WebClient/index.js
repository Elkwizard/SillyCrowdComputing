const UPDATE_DELAY = 30000;

const threads = new Array(navigator.hardwareConcurrency)
	.fill()
	.map(() => new Worker("./worker.js"));

const $ = document.getElementById.bind(document);

const getExplored = async () => {
	const response = await fetch("/explored");
	const explored = await response.json();
	return explored;
};

const getNewChunk = async () => {
	const response = await fetch("/question");
	if (response.status !== 200)
		throw new Error(`Bad Status Code: ${response.status} (${response.statusText})`);
	return response.json();
};

const sendResult = async (result, minerID) => {
	await fetch(`/answer?${new URLSearchParams({
		minerID, user: userColor
	})}`, {
		method: "POST",
		body: JSON.stringify(result)
	});
};

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

const updateView = async () => {
	const explored = await getExplored();
	if (currentChunk) explored.push({
		chunk: currentChunk,
		out: "",
		user: userColor,
		progress: true
	});
	const width = 1 + Math.max(0, ...explored.map(record => record.chunk[0]));
	const height = 1 + Math.max(0, ...explored.map(record => record.chunk[1]));
	
	const view = $("view");
	view.style.gridTemplateRows = `repeat(${height}, 1fr)`;
	view.style.gridTemplateColumns = `repeat(${width}, 1fr)`;

	view.innerHTML = "";
	for (const { chunk: [x, y], user, progress, out } of explored) {
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

	$("explored").textContent = explored.length;
	document.title = `Save the World! (${explored.length})`;
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

addEventListener("load", async () => {
	try {
		for (const tile of document.getElementsByClassName("userColor"))
			tile.style.color = userColor;
		$("offer").dataset.userColor = userColor;
		await updateView();
	
		$("start").addEventListener("click", () => setComputeState(true));
		$("stop").addEventListener("click", () => setComputeState(false));
		$("utilizationInput").addEventListener("input", event => {
			$("utilization").textContent = Math.round(event.target.value);
			localStorage.userUtilization = event.target.value;
		});
		$("utilizationInput").setAttribute("step", 100 / threads.length);
		$("utilizationInput").value = localStorage.userUtilization ?? "100";
		setComputeState(false);
		
		const compute = async () => {
			try {
				const utilization = $("utilizationInput").value / 100;
				if (computing && utilization > 0) {
					const { chunk, minerID } = await getNewChunk();
					currentChunk = [chunk.x / chunk.width, chunk.y / chunk.height];
					await updateView();
					const answer = await solveChunk(chunk, utilization);
					await sendResult(answer, minerID);
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