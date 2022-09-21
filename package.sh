#!/bin/sh 

name=`grep '"id"'  'extension/manifest.json' \
	| cut -d: -f3 \
	| grep -o '"[^"]\+"' \
	| tr -d '"' \
	| cut -d@ -f1`

rm -f "${name}.xpi"
cd 'extension'
zip -1 -r "../${name}.xpi" *
