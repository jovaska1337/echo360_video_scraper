"use strict";

const SUBMIT_GO = 0;
const SUBMIT_RD = 1;

let title, form, form_list, submit_button, tab, busy = false, auto = false;

const create_checkbox = (name) => {
	const [item, span, input, label] =
		["li", "span", "input", "label"]
		.map((a) => document.createElement(a))
	
	input.type = "checkbox";
	label.textContent = name;

	input.addEventListener("click", (e) => e.preventDefault());
	span.addEventListener("click", (e) => {
		e.preventDefault();

		if (input.getAttribute("disabled") != null)
			return;

		input.checked ^= 1;
		input.dispatchEvent(new InputEvent("input"));
	});

	span.appendChild(input);
	span.appendChild(label);
	item.appendChild(span);

	return [item, input];
};

const create_spacer = () => {
	const [item, hr] =  ["li", "hr"]
		.map((a) => document.createElement(a))
	
	item.appendChild(hr);

	return item;
};

const page_ready = async () => {
	let resp;

	resp = await browser.tabs
		.sendMessage(tab.id, { type: MSG_LIST });
	resp = resp.list;

	/* count entries */
	let count = 0;
	for (const value of Object.values(resp))
		count += value.length;

	const entries = [];

	if (count > 0) {
		form_list.appendChild(create_spacer());

		const [item_all, input_all] =
			create_checkbox("Select All");

		const [item_auto, input_auto] =
			create_checkbox("Force Autoindex");

		const all = [];

		input_all.addEventListener("input", () => {
			for (const input of all)
			{
				if (input.getAttribute("disabled") != null)
					continue;
				input.checked = input_all.checked;
			}
		});

		input_auto.addEventListener("input",
			() => auto = input_auto.checked);

		form_list.appendChild(item_all);
		form_list.appendChild(item_auto);
		form_list.appendChild(create_spacer());

		let i = 0;

		/* process by category */
		for (const key of Object.keys(resp))
		{
			/* category name? */
			if (key.length > 0) {
				const name = document.createElement("h4");
				name.textContent = key;
				form_list.appendChild(name);
			}

			/* add entries */
			for (const entry of resp[key])
			{
				const [item, input] =
					create_checkbox(entry.name + (
						(entry.available) ?
						"" : " (unavailable)"));

				if (!entry.available)
					input.setAttribute("disabled", "");

				entry.index = input.name = i++;
				all.push(input);
				form_list.appendChild(item);

				/* add to entries */
				entries.push(entry);
			}

			form_list.appendChild(create_spacer());
		}

		const [item_submit, input_submit] = ["li", "input"]
			.map((a) => document.createElement(a))

		input_submit.type = "submit";
		input_submit.value = "Go";
		input_submit.action = SUBMIT_GO;

		submit_button = input_submit;

		item_submit.appendChild(input_submit);
		form_list.appendChild(item_submit);
	} else {
		const item = document.createElement("li");
		
		item.textContent = "<empty>";

		form_list.appendChild(item);
	}


	resp = await browser.tabs.sendMessage(
		tab.id, { type: MSG_STAT });
	
	switch (resp.state) {
	case STATE_IDLE:
		title.textContent = "READY";
		break;

	case STATE_WORK:
		title.textContent = "WORKING...";
		submit_button.setAttribute("disabled", "");
		busy = true;
		break;
	}

	return entries;
};

const page_failed = async () => {
	title.textContent = "FAILED";

	//const [item, input] = ["li", "input"]
	//	.map((a) => document.createElement(a));

	//input.type = "submit";
	//input.value = "Reload";
	//input.action = SUBMIT_RD;

	//item.appendChild(input);
	//form_list.appendChild(create_spacer());
	//form_list.appendChild(item);
};

let entries = null;

const render_page = async () => {
	let failed = false;

	while (form_list.childNodes.length > 0)
		form_list.removeChild(form_list.childNodes[0]);

	try {
		await browser.tabs
			.sendMessage(tab.id, { type: MSG_INIT });
	} catch {
		failed = true;
	}

	if (failed) {
		await page_failed();
		entries = [];
	} else {
		entries = await page_ready();
	}
};

browser.runtime.onMessage.addListener((msg, sender, respond) => {
	switch (msg.type) {
	case MSG_WORK:
		if (msg.state == WORK_DONE) {
			title.textContent = "READY";
			submit_button.removeAttribute("disabled");
			busy = false;
		}
		break;
	}
});

addEventListener("load", async () => {
	[title, form, form_list] = ["title", "form", "form_list"]
		.map((a) => document.getElementById(a));
	
	form.addEventListener("submit", async (e) => {
		e.preventDefault();

		switch (e.submitter.action) {
		case SUBMIT_GO:
			const data = new FormData(form);
			const keys = [...data.keys()].map((a) => parseInt(a));

			if ((keys.length < 1) || busy)
				return;

			const resp = await browser.tabs
				.sendMessage(tab.id, {
					type: MSG_WORK,
					data: entries
					.filter((e, i) => keys.indexOf(i) != -1)
					.map(e => ({
						name : e.name,
						uuid : e.uuid,
						index: e.index })),
						auto : auto });

			if (resp.state == WORK_INIT) {
				title.textContent = "WORKING...";
				submit_button.setAttribute("disabled", "");
				busy = true;
			}
			break;

		case SUBMIT_RD:
			await render_page();
			break;
		}
	});

	tab = (await browser.tabs.query(
		{ active:true, currentWindow: true }))[0];

	await render_page();
});
