#!/bin/sh

######################## CONFIGURATION ########################

# how many threads to use when encoding/decoding
#THREADS=`expr \`nproc\` '*' 2`
THREADS=1

# audio and video codec options
VIDEO_CODEC='-b:v 150k -c:v libvpx-vp9'
AUDIO_CODEC=`echo '-b:a 32k -ac 1 -c:a libopus -application audio' \
	'-vbr on -compression_level 10 -frame_duration 60'`

# dual pass encode?
DUAL_PASS=1

# which audio channel to use
CHANNEL=0

# overlay positions
#OVERLAY='x=0:y=0' # top-left
#OVERLAY='x=0:y=H-h' # top-right
#OVERLAY='x=0:y=H-h' # bottom-left
OVERLAY='x=W-w:y=H-h' # bottom-right

# how much smaller is the possible second overlaid stream
# compared to the main background stream
FACTOR='0.2'

# extra options
# (this specifies encoding threads)
EXTRA_OPTS="-threads ${THREADS} -shortest -map_metadata -1"
# (this specifies decoding threads)
GLOBAL_OPTS="-hide_banner -loglevel error -stats -nostdin -y -threads ${THREADS}"

######################## CONFIGURATION ########################

# filter complexes for ffmpeg, can be concatenated
VIDEO_FILTER=`echo \
	"[2:0]scale=${FACTOR}*in_w:${FACTOR}*in_h[s];" \
	"[1:0][s]overlay=${OVERLAY}[vout]"`
AUDIO_FILTER="[0:0]pan=mono|c${CHANNEL}=FL[aout]"

# base for the ffmpeg command
CMD_BASE="ffmpeg ${GLOBAL_OPTS}"

# simple command line
[ "$1" -eq 1 ] 2>/dev/null && force_encode=1 || force_encode=0

I=`ls . | grep '[0-9]\+\.\(mkv\|webm\)' | tail -n1 | grep -o '[0-9]\+'`
[ -z "$I" ] && I=0 || I=`expr "$I" + 1`

J=0
while true; do
	V='s1q1' # main video stream
	W='s2q1' # overlay video stream
	A='s0q0' # audio stream
	if [ "$J" -gt 0 ]; then
		V="${V}_${J}"
		W="${W}_${J}"
		A="${A}_${J}"
	fi
	V="${V}.m4s"
	W="${W}.m4s"
	A="${A}.m4s"

	# audio stream can have two qualities
	# so handle s0q0 and s0q1
	[ ! -f "$A" ] && A=`echo "$A" | sed -e 's/q0/q1/g'`

	# at least the main video stream s1q1 and
	# one audio stream must exist
	[ ! -f "$V" -o ! -f "$A" ] && break

	CMD="${CMD_BASE} -i '${A}' -i '${V}'"

	# need to re-encode (to overlay s2q1 with s1q1)
	if [ -f "$W" ]; then
		O="`printf '%.02d' "$I"`.webm"
		CMD=`echo "${CMD} -i '${W}' -filter_complex" \
			"'${VIDEO_FILTER};${AUDIO_FILTER}' ${VIDEO_CODEC}" \
			" ${AUDIO_CODEC} -map [vout] -map [aout]" \
			"${EXTRA_OPTS}" -f webm`

		echo "ENCODE: ${V}, ${W}, ${A} -> ${O}"

		if [ "${DUAL_PASS}" -eq 1 ]; then
			eval "${CMD} -pass 1 /dev/null" \
				 && eval "${CMD} -pass 2 '${O}'" || exit 1

			rm 'ffmpeg2pass-0.log'
		else
			eval "${CMD} '${O}'"
		fi

		rm "$W"

	# encoding forced (to fix broken audio, not mono by default)
	# re-encode video as well to save space
	elif [ "$force_encode" -ne 0 ]; then
		O="`printf '%.02d' "$I"`.webm"
		CMD=`echo "${CMD} -filter_complex '${AUDIO_FILTER}'" \
			"${VIDEO_CODEC} ${AUDIO_CODEC} -map 1:0 -map [aout]" \
			"${EXTRA_OPTS} -f webm"`

		echo "ENCODE: ${V}, ${A} -> ${O}"

		if [ "${DUAL_PASS}" -eq 1 ]; then
			eval "${CMD} -pass 1 /dev/null" \
				&& eval "${CMD} -pass 2 '${O}'" || exit 1
			rm 'ffmpeg2pass-0.log'
		else
			eval "${CMD} '${O}'" || exit 1
		fi

	# remux will do
	else
		O="`printf '%.02d' "$I"`.mkv"
		CMD=`echo "${CMD} -codec copy -map 1:0 -map 0:0" \
			"${EXTRA_OPTS} -f matroska '${O}'"`

		echo "REMUX: ${V}, ${A} -> ${O}"

		eval "$CMD" || exit 1
	fi

	rm "$V" "$A"

	I=`expr "$I" + 1`
	J=`expr "$J" + 1`
done
