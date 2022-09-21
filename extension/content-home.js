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
const videos = [];
const input = [];

let working = false, output, iframe = null, current,
	rows, loaded = false, init_respond = null, waiting = false;

const download = () => {
	if (!iframe) {
		iframe = document.createElement("iframe");

		iframe.height = window.innerHeight;
		iframe.width = window.innerWidth;

		iframe.style.display = "none";

		iframe.addEventListener("load", () => {
			const script = document.createElement("script");
			script.src = browser.runtime.getURL("inject.js");
			iframe.contentDocument.head.appendChild(script);
		});

		document.body.appendChild(iframe);
	}

	iframe.src = "";

	const keys = Object.keys(info.files);
	if (keys.length > 0) {
		output += "# uuid: " + info.uuid + "\n";
		output += "# name: " + info.name + "\n";
		output += "# index: " + current[2] + "\n";

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

	if (input.length < 1) {
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

		return;
	}

	current = videos[input.shift()];

	iframe.src = "https://echo360.org.uk/lesson/"
		+ current[0] +  "/classroom";
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
		videos.length = 0;

		const nodes = rows.querySelectorAll("div.class-row");
		for (let i = 0; i < nodes.length; i++)
			videos.push([
				nodes[i].getAttribute("data-test-lessonid"),
				nodes[i].querySelector(
					"header.header").textContent.trim(),
				i
			]);

		respond({ type: MSG_LIST, list: videos.map((a) => a[1]) });
		break;
	
	case MSG_WORK:
		if (working) {
			respond({ type: MSG_WORK, state: WORK_BUSY });
			break;
		}

		respond({ type: MSG_WORK, state: WORK_INIT });
		working = true;

		input.length = 0;
		msg.data.forEach((a) => input.push(a));

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
	rows = document.querySelector("div.contents-wrapper");

	const resp = await browser.runtime.sendMessage(
		{ type: MSG_COOK, domain: ".echo360.org.uk" });

	for (const cookie of resp.cookies)
		cookies.push(cookie.name + "=" + cookie.value);
	
	if (init_respond)
		init_respond({ type: MSG_INIT });

	loaded = true;
});

const WM_INFO = 0;

addEventListener("message", (e) => {
	const msg = e.data;

	switch (msg.type) {
	case WM_INFO:
		Object.assign(info, msg.info);
		download();
		break;
	}
});
