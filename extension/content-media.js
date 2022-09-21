"use strict";

const MSG_INIT = 0;
const MSG_LIST = 1;
const MSG_WORK = 2;
const MSG_STAT = 3;
const MSG_WAIT = 4;
const MSG_COOK = 5;

const WORK_INIT = 0;
const WORK_BUSY = 1;
const WORK_DONE = 2;

const STATE_WORK = 0;
const STATE_IDLE = 1;

const info = { name: null, uuid: null, files: [] };

const cookies = [];

let working = false, output, loaded = false,
	init_respond = null, waiting = false;

const download = () => {
	const keys = Object.keys(info.files);
	if (keys.length > 0) {
		output += "# uuid: " + info.uuid + "\n";
		output += "# name: " + info.name + "\n";
		output += "# index: auto\n";

		for (const key of keys.filter((k1) => {
			for (const k2 of keys)
			{
				if (k1.substr(0, 2) != k2.substr(0, 2))
					continue;

				if (parseInt(k1.substr(2, 1)) < parseInt(k2.substr(2, 1)))
					return NodeFilter.FILTER_REJECT;
			}

			return NodeFilter.FILTER_ACCEPT;
		}).sort())
			output += key + ".m4s;" + info.files[key] + "\n";

		output += "\n";
	}

	const a = document.createElement("a");

	a.download = "echo360.txt";
	a.href = URL.createObjectURL(new Blob([output]));
	a.click();
	
	URL.revokeObjectURL(a.href);

	document.body.removeChild(iframe);
	iframe = null;

	browser.runtime.sendMessage(
		{ type: MSG_WORK, state: WORK_DONE })
		.then(() => working = false);
};

/* message handler */
browser.runtime.onMessage.addListener((msg, sender, respond) => {
	let ret = false;

	switch (msg.type) {
	case MSG_INIT:
		if (loaded) {
			respond({ type: MSG_INIT });
		} else {
			init_respond = respond;
			ret = true;
		}

		break;

	case MSG_LIST:
		respond({ type: MSG_LIST, list: [ info.name ] });
		break;
	
	case MSG_WORK:
		if (working) {
			respond({ type: MSG_WORK, state: WORK_BUSY });
			break;
		}

		respond({ type: MSG_WORK, state: WORK_INIT });
		working = true;

		output = "";
		for (const cookie of cookies)
			output += "# cookie: " + cookie + "\n";
		output += "\n";

		download();
		break;
	
	case MSG_STAT:
		respond({ type: MSG_STAT, state: 
			(working) ? STATE_WORK : STATE_IDLE });
		break;
	
	case MSG_WAIT:
		waiting = true;

		respond({ type: MSG_WAIT });
		break;
	}

	return ret;
});

addEventListener("load", async () => {
	const script = document.createElement("script");
	script.src = browser.runtime.getURL("inject.js");
	document.head.appendChild(script);

	const resp = await browser.runtime.sendMessage(
		{ type: MSG_COOK, domain: ".echo360.org.uk" });

	for (const cookie of resp.cookies)
		cookies.push(cookie.name + "=" + cookie.value);
});

const WM_INFO = 0;

addEventListener("message", (e) => {
	const msg = e.data;

	switch (msg.type) {
	case WM_INFO:
		Object.assign(info, msg.info);

		/* allow popup to initiate download */
		if (init_respond)
			init_respond({ type: MSG_INIT });

		loaded = true;

		break;
	}
});
