#!/bin/sh

INPUT='echo360.cat'

script_path()
{
	prg="$0"
	[ ! -f "$prg" ] && prg=`which -- "$prg"`
	echo "`cd \`dirname -- "$prg"\` && pwd`"
}

# concatenate all files (the script handles that)
if [ ! -f "$INPUT" ]; then
	cat echo360*.txt > "$INPUT" 2>/dev/null
	if [ "$?" -ne 0 ]; then
		echo "No files."
		rm "$INPUT"
		exit 1
	fi
	rm echo360*.txt
fi

# call script
python "`script_path`/echo360.py" "$@" < "$INPUT" \
	&& rm "$INPUT"
