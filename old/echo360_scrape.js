((spec) => {
"use_strict";

const videos_in = [...(document.querySelector("div.contents-wrapper")
	.querySelectorAll("div.class-row"))].map(
	(node, i) => [node.getAttribute("data-test-lessonid"),
	node.querySelector("header.header").textContent.trim(), i]);

const videos = [];

const range = spec.split("-").map((a) => a.trim());
const multi = spec.split(",").map((a) => a.trim());

const get_index = (a) => {
	if (a.toLowerCase() == "first") {
		return 0;
	} else if (a.toLowerCase() == "last") {
		return videos_in.length - 1;
	} else {
		const tmp = parseInt(a);
		if (Object.is(tmp, NaN))
			return null;
		else
			return tmp;
	}
};

if (range.length == 2) {
	let i = get_index(range[0]);
	let j = get_index(range[1]);

	if ((i != null) && (j != null))
		for (; i <= j; i++)
			videos.push(videos_in[i]);

} else if (multi.length > 1) {
	for (const i of multi)
	{
		const j = get_index(i);

		if (j == null)
			continue
		
		if (!videos.includes(videos_in[j]))
			videos.push(videos_in[j]);
	}
} else {
	const i = get_index(spec);

	if (i != null)
		videos.push(videos_in[i]);
}

if (videos.length < 1) {
	alert("No files selected by filespec.");
	return;
}

const iframe = document.createElement("iframe");

iframe.height = Math.trunc(window.innerHeight / 2);
iframe.width = Math.trunc(window.innerWidth / 2);

iframe.style.display = "block";
iframe.style.position = "fixed";
iframe.style.bottom = "10px";
iframe.style.right = "10px";
iframe.style.zIndex = "999999";

document.body.appendChild(iframe);

const print_call = (func, ...args) => {
	let out = func + "(";

	for (let i = 0; i < args.length; i++)
	{
		if (i != 0)
			out += ", ";
		out += "'" + args[i] + "'";
	}

	out += ")";

	console.log(out);
};

const requests = {};
const segments = {};

const found = [];

const STRM_TIMEOUT = 1000; // ms
const QUAL_TIMEOUT = 500; // ms

iframe.addEventListener("load", () => {
	console.log("iframe loaded");

	const my_window = iframe.contentWindow;
	const my_document = my_window.document;
	const xhr_proto = my_window.XMLHttpRequest.prototype;

	const __fetch = my_window.fetch;
	const __xhr_open = xhr_proto.open;
	const __xhr_send = xhr_proto.send;

	Object.keys(requests).forEach((key) => delete requests[key]);
	Object.keys(segments).forEach((key) => delete segments[key]);

	found.length = 0;

	let request_key = 0;

	let strm_timeout = null;
	let qual_timeout = null;

	//my_window.fetch = async (...args) => {
	//	print_call("fetch", ...args);
	//	result = await __fetch(...args);
	//	console.log(result);
	//	return result;
	//};

	xhr_proto.open = function() {
		const xhr = this;

		xhr.__request_key = request_key;
		requests[request_key++] = xhr;

		//print_call("XHR[" + xhr.__request_key + "]: open", ...arguments);

		this.addEventListener("readystatechange", (e) => {
			if (xhr.readyState != 4)
				return;

			//console.log("XHR[" + xhr.__request_key + "]: finished.");
			
			const m = xhr.responseURL.match(/s([012])(q[01])\.m4s/);
			if (m) {
				const f = m[0].split(".")[0];
				const s = m[1];
				const q = m[2];

				if (!segments[f]) {
					console.log("Found URL for '" + f + "'.");
					segments[f] = xhr.responseURL
				}

				if (!found.includes(s)) {
					found.push(s);

					if (strm_timeout)
						clearTimeout(strm_timeout);

					if ((found.length >= 3) && !qual_timeout) {
						console.log("Found all streams, waiting "
							+ QUAL_TIMEOUT + "ms for all qualities.");

						qual_timeout = setTimeout(restart, QUAL_TIMEOUT);
					} else {
						console.log("Found new streams, waiting "
							+ STRM_TIMEOUT + "ms for new streams.");

						strm_timeout = setTimeout(restart, STRM_TIMEOUT);
					}
				}
			}

			delete requests[xhr.__request_key];
		});

		return __xhr_open.call(xhr, ...arguments);
	};

	xhr_proto.send = function() {
		const xhr = this;

		//print_call("XHR[" + xhr.__request_key + "]: open", ...arguments);

		return __xhr_send.call(xhr, ...arguments);
	};

	//Object.freeze(my_window.fetch);
	Object.freeze(xhr_proto);
});

let output = "";
let current = null;

if (document.cookie.length < 1) {
	alert("Install echo360 Set-Cookie stripper.");
	return;
}

for (const cookie of document.cookie.split(";"))
	output += "# cookie: " + cookie.trim() + "\n";
output += "\n";

const restart = () => {
	iframe.src = "";

	const keys = Object.keys(segments);
	if (keys.length > 0) {
		output += "# uuid: " + current[0] + "\n";
		output += "# name: " + current[1] + "\n";
		output += "# indx: " + current[2] + "\n";

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
			output += key + ".m4s;" + segments[key] + "\n";

		output += "\n";
	}

	if (videos.length < 1) {
		const a = document.createElement("a");

		a.download = "echo360.txt";
		a.href = URL.createObjectURL(new Blob([output]));
		a.click();
		
		URL.revokeObjectURL(a.href);

		document.body.removeChild(iframe);

		return;
	}

	current = videos.shift();

	console.log(current[1]);

	iframe.src = "https://echo360.org.uk/lesson/"
		+ current[0] +  "/classroom";
};

restart();

})("first - last"); // specify start and end index here
