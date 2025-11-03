import crypto from "node:crypto";

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

export default (chunks, user) => {
	const simplified = chunks.map(chunk => ({
		chunk: chunk.chunk,
		user: chunk.user,
		answer: !!chunk.out
	}));
	return wiggleColors(JSON.stringify(simplified), user);
};