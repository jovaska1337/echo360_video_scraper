"use strict";

const WM_INFO = 0;

/* The document should be loaded when this script is injected. */
(async () => {
	let urlbase = null, params = null,
		name = null, uuid = null, medias = null;

	const streams = [];

	/* match JSON info */
	const m_1 = /Echo\["classroomApp"\]\("((?:[^"\\]|\\.)+)"/i
		.exec(document.body.innerHTML);
	const m_2 = /Echo\["mediaPlayerBootstrapApp"\]\("((?:[^"\\]|\\.)+)"/i
		.exec(document.body.innerHTML);

	/* on the classroom page, the info JSON is embedded */
	if (m_1) {
		const info = JSON.parse(m_1[1].replaceAll("\\\"", "\""));
	
		/* properties we're interested in */
		name = info.lesson.name;
		uuid = info.video.mediaId;
		medias = info.video.playableMedias;

	/* on the media page, the info JSON is external */
	} else if (m_2) {
		const boot = JSON.parse(m_2[1].replaceAll("\\\"", "\""));

		/* fetch the external JSON */
		const json = (await ((await fetch(
			"https://echo360.org.uk/api/ui/echoplayer/public-links/"
			+ boot.publicLinkId + "/media/"
			+ boot.mediaId + "/player-properties")).json())).data;

		/* propeties we're interested in */
		name = json.mediaName;
		uuid = boot.mediaId;
		medias = json.playableAudioVideo.playableMedias;
	}

	if (medias) {
		/* streams */
		for (const media of medias)
		{
			const i = media.sourceIndex;

			streams[i] ?? (streams[i] = []);

			for (const quality of media.quality)
				!streams[i].includes(quality)
					&& streams[i].push(quality);
		}
	}

	const proto = XMLHttpRequest.prototype;

	/* we can extract the URL from here */
	const xhr_open = proto.open;

	let searching = true;

	proto.open = function () {
		const xhr = this;
		const url = arguments[1]; // we're interested in this

		/* extract GET parameters from the request URL */
		if (searching) {
			const e = /(?<=\/)s[0-9]q[0-9]\.m4s?(?=\?)/i;
			const m = e.exec(url);

			if (m) {
				const [urlbase, params] = url.split(e);

				/* we can now reply with the stream info */
				const info = {
					name: name,
					uuid: uuid,
					files: {}
				};

				for (const [s, qs] of streams.entries())
				{
					for (const q of qs)
					{
						const file = "s" + s + "q" + q;

						info.files[file] = urlbase
							+ file 
							+ ".m4s" + params;
					}
				}

				parent.postMessage({
					type: WM_INFO, info: info });
	
				searching = false;
			}
		}

		/* call original function */
		return xhr_open.apply(this, arguments);
	};

	/* make sure nothing else modifies the XMLHttpRequest prototype */
	Object.seal(proto);
})();
