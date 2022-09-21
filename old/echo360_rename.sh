#!/bin/sh

while read 'line'; do
	indx=`echo "$line" | cut -d\; -f1`
	name=`echo "$line" | cut -d\; -f2`

	[ -z "$name" -o -z "$indx" ] && continue

	file=`printf '%s\n' "$indx".* | head -n1`

	if [ ! -f "$file" ]; then
		echo "No matching file for '${name}'."
		continue
	fi

	echo mv "${file}" "${indx} - ${name}`echo "$file" \
		| grep -o '\.[^.]\+$'`"
done < 'name.map'
