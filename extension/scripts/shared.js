"use strict";

/* message ids */
const MSG_INIT = 0;
const MSG_LIST = 1;
const MSG_WORK = 2;
const MSG_STAT = 3;
const MSG_WAIT = 4;
const MSG_COOK = 5; 

/* working state messages */
const WORK_INIT = 0;
const WORK_BUSY = 1;
const WORK_DONE = 2;

/* work states */
const STATE_WORK = 0;
const STATE_IDLE = 1;

/* for extracting JSON metadata from the document body */
const RE_METADATA = /Echo\["([^"]+)"\]\("((?:[^"\\]|\\.)+)"/ig;

/* metadata parser */
const parse = html => {
	/* loop through all matches */
	let match, data = {};
	RE_METADATA.lastIndex = 0;
	while ((match = RE_METADATA.exec(html)))
	{
		/* split */
		const [a, b, c] = match;

		/* only allow a section once */
		if (data[b] === undefined)
			data[b] = JSON.parse(c.replaceAll("\\\"", "\""));

		/* break on loopback */
		if (RE_METADATA.lastIndex == 0)
			break;
	} 

	return data;
};

/* retreive the required cookies */
const get_cookies = async () => (await browser.runtime.sendMessage({
	type  : MSG_COOK,
	domain: ".echo360.org.uk",
	names : [
		/* testing showed that only these are required */
		"CloudFront-Policy",
		"CloudFront-Signature",
		"CloudFront-Key-Pair-Id" ] })).cookies;

/* echo360.txt generator */
const download = data => {
	let output = "";

	/* append cookies */
	for (const key of Object.keys(data.cookies))
		output += `# cookie: ${key}=${data.cookies[key]}\n`;
	output += "\n";
	
	/* append streams */
	for (const entry of data.data)
	{
		/* header */
		output += `# name: ${entry.name}\n`;
		output += `# uuid: ${entry.uuid}\n`;
		output += `# index: ${
			data.auto || (entry.index < 0)
				? "auto" : entry.index }\n`;

		/* select best streams */
		const streams = {};
		for (const stream of entry.streams)
		{
			const i   = stream.sourceIndex;
			const old = streams[i];
			
			/* no stream with this index yet */
			if (old === undefined) {
				streams[i] = stream;

			/* stream exists */
			} else {
				const a = stream.quality[0];
				const b = old.quality[0];
				const c = stream.trackType.length;
				const d = old.trackType.length;

				/* selected in this order:
				 * 1. quality
				 * 2. minimal track count
				 */
				 if ((a > b) || ((a == b) && (c < d)))
					streams[i] = stream;
			}
		}

		/* append to output */
		for (const key of Object.keys(streams))
			output += `${key};${streams[key].uri}\n`;
		output += "\n";
	}

	/* download */
	const a = document.createElement("a");

	a.download = "echo360.txt";
	a.href = URL.createObjectURL(new Blob([output]));
	a.click();

	URL.revokeObjectURL(a.href);
};
