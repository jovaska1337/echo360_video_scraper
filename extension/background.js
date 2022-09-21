"use strict;"

const MSG_INIT = 0;
const MSG_LIST = 1;
const MSG_WORK = 2;
const MSG_STAT = 3;
const MSG_WAIT = 4;
const MSG_COOK = 5;

browser.runtime.onMessage.addListener((msg, sender, respond) => {
	let ret = false;

	switch (msg.type) {
	case MSG_COOK:
		browser.cookies.getAll(
			{ domain: msg.domain, firstPartyDomain: null })
			.then((value) => respond({ type: MSG_COOK, cookies: value }))
			.catch(() => respond({ type: MSG_COOK, cookies: [] }));

		ret = true;
		break;
	}

	return ret;
});
