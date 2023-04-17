"use strict";

/* start requesting the lecture metadata (await:ed on load) */
let metadata = (async () => await (await
	fetch(new String(location).replace(/home$/, "syllabus"))).json())();

/* request cookies (await:ed on load) */
let cookies = get_cookies(); 

/* state machine */
let loaded  = false;
let working = false;
let waiting = false;

/* global respond() */
let g_respond = null;

/* stream list parsed from metadata on load */
const list = {};

/* get stream metadata */
const streams = async list => {
	/* process each entry */
	for (const entry of list)
	{
		/* download html */
		const html = await (await fetch(
			`https://echo360.org.uk/lesson/${entry.uuid}/classroom`
				)).text();

		/* parse metadata */
		const metadata = parse(html);
		if (metadata.classroomApp === undefined)
			continue;

		/* extract stream info */
		entry.streams = metadata.classroomApp.video.playableMedias;

		/* compactify echo360.txt by extracting params */
		if (entry.streams.length > 0) {
			entry.params = {};

			for (const param of entry.streams[0].uri.split("?")[1].split("&"))
			{
				const [key, value] = param.split("=");
				entry.params[key] = value; 
			}
		} else {
			entry.params = null;
		}

		for (const stream of entry.streams)
			stream.uri = stream.uri.split("?")[0];
	}

	return list;
};

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

		respond({ type: MSG_WORK, state: WORK_INIT });
		working = true;

		/* retreive stream info */
		streams(msg.data).then(data => {
			/* download echo360.txt */
			download({
				cookies: cookies,
				data   : data,
				auto   : msg.auto });

			browser.runtime.sendMessage({
				type : MSG_WORK,
				state: WORK_DONE });
			working = false;
		});
		break;
	
	case MSG_STAT:
		respond({ type: MSG_STAT, state: 
			(working) ? STATE_WORK : STATE_IDLE });
		break;
	}

	return ret;
});

/* wait for the document to finish loading */
const onload = async () => {
	/* wait for pending promises */
	metadata = await metadata;
	cookies  = await cookies;

	/* parse metadata */
	for (const entry of metadata.data)
	{
		let lessons = null, group = "";

		/* grouped lessons */
		if (entry.type == "SyllabusGroupType") {
			group   = entry.groupInfo.name;
			lessons = entry.lessons.map(x => x.lesson);

		/* single lesson */
		} else if (entry.type == "SyllabusLessonType") {
			lessons = [ entry.lesson ];

		/* not handled by us */
		} else {
			continue;
		}

		/* handle lessons */
		for (const lesson of lessons)
		{
			/* only support single media entry */
			let media = null;
			if (lesson.medias.length > 0)
				media = lesson.medias[0];

			/* stream is possible to download */
			let available = lesson.hasVideo
				&& !lesson.isLive
				&& (media != null)
				&& media.isAvailable;

			/* create grouped entry */
			if (list[group] === undefined)
				list[group] = [];
			list[group].push({
				name     : lesson.lesson.name,
				uuid     : lesson.lesson.id,
				available: available});
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
