"use strict;"

/* null response for MSG_COOK */
const MSG_COOK_NULL = { type: MSG_COOK, cookies: null };

/* handle MSG_COOK (cookie request) */
browser.runtime.onMessage.addListener((msg, sender, respond) => {
	let ret = false;

	switch (msg.type) {
	case MSG_COOK:
		/* sanity check */
		if (
			!(msg.names instanceof Array) ||
			!(msg.domain != null)
		) {
			respond(MSG_COOK_NULL);
			return;
		}

		/* consider cookie stores in order to handle
		 * private windows and container tabs
		 */
		browser.cookies.getAllCookieStores()
		.then(async value => {
			/* find the cookie store id for the sender tab */
			let id = null;
			for (const store of value)
			{
				if (store.tabIds.indexOf(sender.tab.id) != -1) {
					id = store.id;
					break;
				}
			}

			/* request the cookies */
			const cookies = {};
			for (const name of msg.names)
			{
				const details = {
					name: name,
					domain: msg.domain,
					firstPartyDomain: null };
				
				/* include tab id (if found) */
				if (id != null)
					details.storeId = id;

				try {
					/* get cookie value and append */
					const value = await browser.cookies.getAll(details);
					if (value.length > 0) {
						/* use the first cookie
						 * (should work for our purposes)
						 */
						const cookie = value[0];
						cookies[cookie.name] = cookie.value;
					}
				} catch {
					/* failure */
					respond(MSG_COOK_NULL);	
					return;
				}
			}

			/* respond */
			respond({ type: MSG_COOK, cookies: cookies });
		})
		.catch((e) => respond(MSG_COOK_NULL));

		ret = true;
		break;
	}

	return ret;
});
