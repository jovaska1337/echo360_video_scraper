"use strict";

const list = {};

/* state machine */
let loaded  = false;
let working = false;

/* global respond() */
let g_respond = null;

/* request cookies (await:ed on load) */
let cookies = get_cookies();

/* streams on this page */
let streams = null;

/* message handler */
browser.runtime.onMessage.addListener((msg, sender, respond) => {
	let ret = false;

	switch (msg.type) {
	case MSG_INIT:
		if (loaded) {
			respond({ type: MSG_INIT });
		} else {
			g_respond = respond;
			ret = true;
		}

		break;

	case MSG_LIST:
		respond({ type: MSG_LIST, list: list });
		break;
	
	case MSG_WORK:
		if (working) {
			respond({ type: MSG_WORK, state: WORK_BUSY });
			break;
		}

		working = true;

		/* there's always one or no entry */
		if (msg.data.length > 0) {
			/* streams aren't passed */
			msg.data[0].streams = streams;

			/* download echo360.txt */
			download({
				cookies: cookies,
				data   : msg.data,
				auto   : true }); // auto is forced
		}

		respond({ type: MSG_WORK, state: WORK_DONE });
		working = false;
		break;
	
	case MSG_STAT:
		respond({ type: MSG_STAT, state: 
			(working) ? STATE_WORK : STATE_IDLE });
		break;
	}

	return ret;
});

const onload = async () => {
	/* wait for cookies */

	/* parse metadata */
	const metadata = parse(document.body.innerHTML);

	/* classroom */
	if (metadata.classroomApp !== undefined) {
		const info = metadata.classroomApp;

		let available = (info.liveLessonInfo == null)
			&& (info.liveTrackingInfo == null)
			&& !info.video.liveTimeAvailable;

		/* data is on the page */
		const entry = {
			name     : info.lesson.name,
			uuid     : info.lesson.id,
			available: available };
		list[""] = [entry];

		streams = info.video.playableMedias;

		/* fuck this nonsense */
		if (streams.length > 0) {
			entry.params = {};
			
			for (const param of streams[0].uri.split("?")[1].split("&"))
			{
				const [key, value] = param.split("=");
				entry.params[key] = value; 
			}

			for (const stream of streams)
				stream.uri = stream.uri.split("?")[0];
		} else {
			entry.params = null;
		}

	/* media */
	} else if (metadata.mediaPlayerBootstrapApp !== undefined) {
		const info = metadata.mediaPlayerBootstrapApp;

		/* if some retard thinks this authentication token nonsense is 
		 * anything other than security theater, they can fuck right off
		 */

		/* wait for boot.js to set authentication token */
		let n = 0, token = null;
		while (1)
		{
			if (n >= 5)
				throw Error("No authentication token. (logic changed?)");

			/* attempt to get token */
			if ((token = localStorage.getItem("authn-jwt")) != null)
				break;

			/* wait for 1 second */
			await new Promise(resolve => setTimeout(resolve, 1000));

			n++;
		}

		/* attempt to retreive external JSON */
		n = 0;
		let json = null;
		while (1)
		{
			if (n >= 5)
				throw Error("Failed to retreive player info. (broken again?)");
		
			try {
				/* null token means we try again */
				if (token == null)
					throw Error("Catch this mothafucka.");

				/* headers for request */
				const headers = new Headers();
				headers.append("Authorization", `Bearer ${token}`);

				/* request player json */
				const response = await fetch(
`https://echo360.org.uk/api/ui/echoplayer/public-links/${info.publicLinkId}/media/${info.mediaId}/player-properties`
				, { headers: headers });

				/* looks ugly, but whatever */
				json = await response.json();
				json = json.data;

				break;
			} catch (e) {
				/* get new token */
				token = localStorage.getItem("authn-jwt");

				/* wait for 1 second */
				await new Promise(resolve => setTimeout(resolve, 1000));

				n++;
			}
		}

		/* always available */
		const entry = {
			name     : json.mediaName,
			uuid     : info.mediaId,
			available: true };
		list[""] = [entry];

		streams = json.playableAudioVideo.playableMedias;
		
		console.log(json);

		if (streams.length > 0) {
			entry.params = {};
			
			for (const param of streams[0].uri.split("?")[1].split("&"))
			{
				const [key, value] = param.split("=");
				entry.params[key] = value; 
			}

			/* this may break but I'm not making it better until it does */
			if (json.sourceQueryStrings != null) {
				if (json.sourceQueryStrings.queryStrings.length != 1)
					throw Error("Broken. :P");

				/* what kind of an idiot comes up with this nonsense */
				for (const param of json.sourceQueryStrings
					.queryStrings[0].queryString.split("&"))
				{
					const [key, value] = param.split("=");
					entry.params[key] = value; 
				}
			}

			for (const stream of streams)
				stream.uri = stream.uri.split("?")[0];
		} else {
			entry.params = null;
		}
	}

	/* respond to early MSG_INIT */
	if (g_respond) {
		g_respond({ type: MSG_INIT });
		g_respond = null;
	}

	/* now loaded */
	loaded = true;
};

/* injected on document_start */
if (document.readyState == "loading")
	addEventListener("DOMContentLoaded", onload);

/* injected after document load */
else
	onload();
