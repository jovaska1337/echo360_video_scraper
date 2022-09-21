#!/bin/sh

# may not work in 100% of cases
dir() {
        prg="$0"
        [ ! -f "$prg" ] && prg=$(which -- "$prg")
        echo "$(cd $(dirname -- "$prg") && pwd)"
}

# default gain to apply
volume=18
rnnnet="$(dir)/arnndn-models/std.rnnn"

# check if -- exists in arguments
has_args=0
for arg in "$@"; do
	if [ "$arg" == -- ]; then
		has_args=1
		break
	fi
done

# parse arguments
if [ $has_args -ne 0 ]; then
	while [ "$1" != -- ]; do
		[ "$1" -gt 0 ] 2>/dev/null \
			&& volume="$1"
		[ -f "$1" ] \
			&& rnnnet="$1"
		shift 1
	done
	shift 1
fi

# neural network must exist
if [ ! -f "$rnnnet" ]; then
	echo "'${rnnnet}' is not a file."
	exit 1
fi

# process all files
for file in "$@"; do
	# ignore non-files
	if [ ! -f "$file" ]; then
		echo "'${file}' is not a file, ignoring..."
		continue
	fi

	ext=$(echo "$file" | grep -o '[^.]\+$')

	if [ "$ext" == mkv ]; then
		fmt=matroska
	elif [ "$ext" == webm ]; then
		fmt=webm
	else
		echo "'${file}' has unknown extension."
		continue
	fi

	echo "Processing '${file}'..."

	# temporary output
	tmp="$(mktemp)"

	while true; do
		# keep up to date with echo360.py
		ffmpeg \
			-hide_banner \
			-loglevel error \
			-stats \
			-y \
			-nostdin \
			-i "$file" \
			-c:v copy \
			-c:a libopus \
			-b:a 32k \
			-ac 1 \
			-application audio \
			-vbr on \
			-compression_level 10 \
			-frame_duration 60 \
			-af "volume=${volume},arnndn=${rnnnet},lowpass=12000,highpass=200" \
			-map 0:v \
			-map 0:a \
			-f "$fmt" \
			"$tmp"
		if [ $? -ne 0 ]; then
			echo "ffmpeg: nonzero exit status."
			break
		fi
		
		# create copy on the same filesystem without replacing file
		cp "$tmp" "$file.new"
		if [ $? -ne 0 ]; then
			echo "cp: nonzero exit status."
			break
		fi

		# finally move
		mv "$file.new" "$file"
		break
	done

	# clean up temp file
	rm "$tmp" "$file.new" 2>/dev/null
done
