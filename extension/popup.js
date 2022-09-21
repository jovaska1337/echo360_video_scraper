"use strict";

const MSG_INIT = 0;
const MSG_LIST = 1;
const MSG_WORK = 2;
const MSG_STAT = 3;
const MSG_WAIT = 4;

const WORK_INIT = 0;
const WORK_BUSY = 1;
const WORK_DONE = 2;

const STATE_WORK = 0;
const STATE_IDLE = 1;

const SUBMIT_GO     = 0;
const SUBMIT_RELOAD = 1;

let title, form, form_list, submit_button, tab, busy = false;

const create_checkbox = (name) => {
	const [item, span, input, label] =
		["li", "span", "input", "label"]
		.map((a) => document.createElement(a))
	
	input.type = "checkbox";
	label.textContent = name;

	input.addEventListener("click", (e) => e.preventDefault());
	span.addEventListener("click", (e) => {
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

	if (resp.list.length > 0) {
		form_list.appendChild(create_spacer());

		const [item_all, input_all] =
			create_checkbox("Select All");

		const all = [];

		input_all.addEventListener("input", () => {
			for (const input of all)
				input.checked = input_all.checked;
		});

		form_list.appendChild(item_all);
		form_list.appendChild(create_spacer());

		for (let i = 0; i < resp.list.length; i++)
		{
			const [item, input] =
				create_checkbox(resp.list[i]);

			input.name = i;
			all.push(input);

			form_list.appendChild(item);
		}

		form_list.appendChild(create_spacer());

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
		
		await browser.tabs.sendMessage(
			tab.id, { type: MSG_WAIT });

		break;
	}

};

const page_failed = async () => {
	title.textContent = "FAILED";

	//const [item, input] = ["li", "input"]
	//	.map((a) => document.createElement(a));

	//input.type = "submit";
	//input.value = "Reload";
	//input.action = SUBMIT_RELOAD;

	//item.appendChild(input);
	//form_list.appendChild(create_spacer());
	//form_list.appendChild(item);
};

const render_page = async () => {
	let failed = false;

	while (form_list.childNodes.length > 0)
		form_list.removeChild(form_list.childNodes[0]);

	try {
		const resp = await browser.tabs
			.sendMessage(tab.id, { type: MSG_INIT });
	} catch {
		failed = true	
	}

	if (failed)
		await page_failed();
	else
		await page_ready();
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
				.sendMessage(tab.id, { type: MSG_WORK, data: keys });

			if (resp.state == WORK_INIT) {
				title.textContent = "WORKING...";
				submit_button.setAttribute("disabled", "");
				busy = true;
			}
			break;

		case SUBMIT_RELOAD:
			await render_page();
			break;
		}
	});

	tab = (await browser.tabs.query(
		{ active:true, currentWindow: true }))[0];

	await render_page();
});
