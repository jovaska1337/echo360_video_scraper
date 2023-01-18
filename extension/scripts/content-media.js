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
	cookies = await cookies;

	/* parse metadata */
	const metadata = parse(document.body.innerHTML);

	/* classroom */
	if (metadata.classroomApp !== undefined) {
		const info = metadata.classroomApp;

		let available = (info.liveLessonInfo == null)
			&& (info.liveTrackingInfo == null)
			&& !info.video.liveTimeAvailable;

		/* data is on the page */
		list[""] = [{
			name     : info.lesson.name,
			uuid     : info.lesson.id,
			available: available }];

		streams = info.video.playableMedias;

	/* media */
	} else if (metadata.mediaPlayerBootstrapApp !== undefined) {
		const info = metadata.mediaPlayerBootstrapApp;

		/* fetch the external JSON */
		const json = (await ((await fetch(
`https://echo360.org.uk/api/ui/echoplayer/public-links/${info.publicLinkId}/media/${info.mediaId}/player-properties`
			)).json())).data;
		
		/* always available */
		list[""] = [{
			name     : json.mediaName,
			uuid     : info.mediaId,
			available: true }];

		streams = json.playableAudioVideo.playableMedias;
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
