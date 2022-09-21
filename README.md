### echo360 Video Scraper
This tool consists of two parts:
1. A Firefox extension which extracts video stream urls and cookies.
2. A python script which performs downloading and video conversion.
The following executables are required to be in `PATH`:
- `ffmpeg`
- `ffprobe`
The following python libraries are required:
- `requests`
- (everything else should be part of a standard python installation)
#### Rationale
Have you ever wanted you view your favourite lecture videos using your
favorite media player without requiring internet connectivity? Are you
tired of laggy and broken browser based interfaces? Do you like watching
long lectures at higher speeds than the echo360.org.uk browser interface
allows? If you answered yes, this tool is for you. The reason the tool is
split up into two parts is that the process of making the python script
jump through all the ridiculous hoops to retreive the stream urls and
authentication cookies is frankly impossible. Using the existing browser
session to retreive metadata through and extension is the simplest and
easiest way to implement this.
#### Instructions
To use the browser extension, you have to be on on an echo360.org.uk
page with one of the following urls:
- `https://echo360.org.uk/section/<uuid>/home`
- `https://echo360.org.uk/media/<uuid>/\*`
You can then use the extension popup window to select which video
streams you want to download. (`/media` pages will always show one)
After selecting the streams and clicking `Go`, the extension will
extract stream urls and cookies from the `echo360.org.uk` domain.
(cookies are required to download the streams, otherwise we'll get
a `HTTP 403 Access Denied`) You will then be prompted to save a text
file called `echo360.txt`. This is the file `echo360.py` takes as
an input from stdin. You can save multiple of these files with the
following format `echo360*.txt` and use `echo360.sh` to pipe all of
them into `echo360.py` at once if a POSIX shell is available.
`echo360.py` will select the streams with highest quality, download
them and, depending on the configuration, re-encode or remux them
using ffmpeg. All files are saved in the working directory. You can
safely interrupt the program with SIGINT (CTRL+C). No cleanup is
performed if any errors occur. Video streams will always be re-encoded
if they have an "overlay" stream or if the video size is too large.
You can use `volume.sh` after `echo360.py` finishes to fix volume levels.
