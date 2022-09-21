#!/bin/sh

escape() {
	echo "$1" | sed -e 's/[][^$.]/\\\0/g'
}

block=0
index=0

actual_index=0
name_print=0
skip_this=0

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36'

#for file in *; do
#	tmp=`echo "$file" | grep -o '^[0-9]\{2\}'`
#	if [ "$?" -eq 0 ]; then
#		[ "$tmp" -eq "$actual_index" ] \
#			&& actual_index=`expr "$tmp" + 1`
#		continue
#	fi
#done

while read 'line'; do
	# whitespace delimits blocks
	if echo "$line" | grep '^\s*$' >/dev/null; then
		if [ "$block" -ne 0 ]; then
			tmp=`printf "%02d" "$actual_index"`
			
			if ! grep "^${tmp};" 'name.map' \
			    >/dev/null \
			    2>/dev/null; then
				printf '%02d;%s\n' \
					"$actual_index" \
					"$name" >> 'name.map'
			fi

			index=`expr "$index" + 1`
			actual_index=`expr "$actual_index" + 1`
		fi

		block=0
		skip_this=0
		name_print=0
	
	# comment shows UUID and name
	elif echo "$line" | grep '^\s*#' >/dev/null; then
		key=`echo "$line" | grep -o '#\s*\S\+\s*:' \
			| sed -e 's/#\s*//g' | sed -e 's/\s*:$//g'`
		val=`echo "$line" | grep -o ':\s*.\+' | sed -e 's/^:\s*//g'`

		[ -z "$key" -o -z "$val" ] && continue

		# handle KV pairs
		case "$key" in
		'name')
			name="$val"
			name_esc=`escape "$val"`;;
		'uuid')
			uuid="$val"
			uuid_esc=`escape "$val"`;;
		'cookie')
			curl_args="${curl_args} -b $val";; 
		esac

	# stream
	elif echo "$line" | grep '^s[012]q[01].m4s;\+https:\/\/' \
	    >/dev/null || continue; then
	    	[ "$skip_this" -ne 0 ] && continue
	    	
		file=`echo "$line" | cut -d\; -f1`
		surl=`echo "$line" | cut -d\; -f2`

		[ "$index" -ne 0 ] \
			&& file=`echo "$file" \
			| sed -e "s/\./_${index}./"`

		if [ "$name_print" -eq 0 ] && grep \
			"^[0-9]\{2\};${name_esc}" 'name.map' \
			>/dev/null 2>/dev/null; then
			echo "'${name}' is in name.map, skipping..."

			[ -f "$file" ] && index=`expr "$index" + 1`
			actual_index=`expr "$actual_index" + 1`

			skip_this=1
			continue
		fi

		[ "$name_print" -eq 0 ] && echo "Downloading '${name}'..."

		echo "[${index}]: ${file} (${actual_index})"

		curl -# -A "$UA" $curl_args "$surl" > "$file"

		name_print=1
		block=1
	fi

done < 'echo360.txt'
