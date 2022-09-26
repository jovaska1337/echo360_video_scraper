### echo360 Video Scraper
This tool consists of two parts:

1. A Firefox extension which extracts video stream urls and cookies.
2. A python script which performs downloading and video conversion.

The following executables are required to be in `PATH`:

- `ffmpeg`
- `ffprobe`
- `nice`
- `cpulimit`

The following python libraries are required:

- `requests`
- (everything else should be part of a standard python installation)

#### Rationale
- Have you ever wanted you view your favourite lecture videos using your
  favorite media player without requiring internet connectivity?
- Are you tired of laggy and broken browser based interfaces?
- Do you like watching long lectures at higher speeds than the
  echo360.org.uk browser interface allows?

If you answered yes, this tool is for you.

The reason the tool is split up into two parts is that the process of
making the python script jump through all the ridiculous hoops required
to retreive the stream urls and authentication cookies is frankly impossible.
Using the existing browser session to retreive metadata through and extension
is the simplest and easiest way to implement this.

#### Instructions
To use the browser extension, you have to be on on an echo360.org.uk
page with one of the following urls:

- `https://echo360.org.uk/section/<uuid>/home`
- `https://echo360.org.uk/media/<uuid>/\*`

1. Navigate to an echo360 classroom or media page with an url like the
   ones above on a browser with the extension installed. **DO NOT USE A
   PRIVATE WINDOW, THIS CAUSES THE WRONG COOKIES TO BE EXTRACTED AND
   YOU'LL GET AN ERROR WHEN DOWNLOADING**
2. Open the extension popup. (refresh the page if nothing shows up)
3. Select the streams you want to download. (`/media` pages always show one)
4. Click `Go`.
5. After the tool scrapes the authentication cookies and video stream urls,
   you'll be prompted to save a file called `echo360.txt`. `echo360.py` will
   take this file as input from stdin.
6. Save the file into the directory you want to download the streams into.
   If you have a POSIX compatible shell available, you can use `echo360.sh` to
   pipe multiple `echo360.txt` files into `echo360.py` by saving them with the
   format `echo360*.txt`. (files will be concatenated in the filesystem order)
7. When you have downloaded all the video stream metadata, either invoke
   `echo360.py` directly, piping `echo360.txt` into stdin
   (`python echo360.py < echo360.txt`) or invoke `echo360.sh` in the directory
   with all the `echo360.txt` files.
8. `echo360.py` will then select the streams with the highest quality,
   download the streams onto disk and either re-encode or remux the streams
   with ffmpeg into  a single video file depending on the internal configuration.
   (see the script for details) It's safe to interrupt the script with `SIGINT`
   (`CTRL+C`). The script will clean up all temporary files if it executes without
   errors. Re-executing after errors should resume correctly. (only partial
   re-encodes/remuxes are discarded)
9. If the volume of the resultant video file is too low, you can use
   `volume.sh` to fix volume levels. (POSIX compatible shell required)
   Multiple paths can be specified. The default configuration can be overridden
   through the command line. (see the script for details) You can simply
   invoke it as follows: `./volume.sh <video path>`
