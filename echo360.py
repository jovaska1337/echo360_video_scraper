#!/bin/env python

import os
import re
import sys
import ssl
import time
import signal
import hashlib
import requests
import subprocess

from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager
from urllib3.util.ssl_ import create_urllib3_context

interrupt = False # SIGINT should raise KeyboardInterrupt

def on_SIGINT(sig, frame):
    if interrupt:
        raise KeyboardInterrupt()

signal.signal(signal.SIGINT, on_SIGINT)

######################## CONFIGURATION ########################

THREADS  = 4
NICENESS = 20
CPULIMIT = 50

# configure video codec here
VIDEO_CODEC = [
    "-b:v", "150k",
    "-c:v", "libvpx-vp9"
]

# configure audio codec here
AUDIO_CODEC = [
    "-b:a", "32k",
    "-ac",  "1",
    "-c:a", "libopus",
    "-application", "audio",
    "-vbr", "on",
    "-compression_level", "10",
    "-frame_duration", "60"
]

ENCODE_EXT = "webm" # output file extension
ENCODE_CNT = "webm" # container type for -f argument

# force encoding of files that can be remuxed
FORCE_ENCODE = False

# enable dual pass encode
# (works with at least vp8, vp9, h264, h265)
DUAL_PASS = 1

# which audio channel to use for mono audio
CHANNEL = 0

# which overlay position to use
OVERLAY = 3 # bottom right

# how much smaller is the possible second overlaid stream
# compared to the main background stream
FACTOR = 0.2

# when to apply a downscale filter
MAX_WIDTH = 1280

# how much can the duration of an existing file differ
# from the main video stream duration, before it's
# considered corrupt (in seconds)
MAX_DURATION_MISMATCH = 0.8

######################## CONFIGURATION ########################

# options before output file
EXTRA_OPTS = [
    "-threads", str(THREADS),
    "-shortest",
    "-map_metadata", "-1"
]

# options before input streams
GLOBAL_OPTS = [
    "-loglevel", "error",
    "-stats",
    "-nostdin",
    "-y",
    "-threads", str(THREADS)
]

# values for the overlay filter
OVERLAYS = [
    "x=0:y=0",    # top-left
    "x=0:y=H-h",  # top-right
    "x=0:y=H-h",  # bottom-left
    "x=W-w:y=H-h" # bottom-right
]

VF_1 = "[1:0]scale={}:{}[vout]"
VF_2 = "[2:0]scale={}:{}[s];[1:0][s]overlay={},scale={}:{}[vout]"
AF_1 = "[0:0]pan=mono|c{}=FL[aout]"

RE_META   = re.compile("^\s*#\s*(\S+)\s*:\s*(.+)$")
RE_SPACE  = re.compile("^\s*$")
RE_STREAM = re.compile("^(s([012])q([01])\.m4s);(https://[^/]+/\S+)")

RE_IND = re.compile("[0-9]{2}\\b")

# value for the User-Agent header when making requests 
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " \
    "AppleWebKit/537.36 (KHTML, like Gecko) " \
    "Chrome/97.0.4692.71 Safari/537.36"

# wrapper for subprocess for consistent exceptions
def run_subprocess(args, output=False, terminal=True):
    global interrupt

    if output:
        stdout = subprocess.PIPE
    elif terminal:
        stdout = None
    else:
        stdout = subprocess.DEVNULL
    
    interrupted = False

    try:
        interrupt = True

        proc = subprocess.Popen(args, \
            stdin=subprocess.DEVNULL, stdout=stdout, stderr=subprocess.STDOUT)
        out = proc.communicate()[0]

    except (OSError, ValueError, subprocess.SubprocessError) as e:
        raise RuntimeError("subprocess failure") from None

    except KeyboardInterrupt:
        proc.terminate()
        interrupted = True

    finally:
        interrupt = False

    proc.wait()

    if interrupted:
        raise KeyboardInterrupt()

    if proc.returncode != 0:
        raise RuntimeError("{}: nonzero exit status ({})" \
            .format(args[0], proc.returncode))

    if output:
        return out
    else:
        return None

RE_INT = re.compile("^[0-9]+$")
RE_HEX = re.compile("^0x[0-9A-F]+$", re.I)
RE_FLT = re.compile("^(?:[0-9]+)?\.[0-9]+$")
RE_RAT = re.compile("^([0-9]+)/([0-9]+)$")

# run ffprobe on a file and return all key-value pairs in a dict
def ffprobe(path):
    proc = subprocess.Popen([
            "ffprobe",
            "-loglevel", "quiet",
            #"-count_packets",
            #"-count_frames",
            "-show_entries", "format:stream",
        path],
        stdin=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdout=subprocess.PIPE)

    out = str(proc.communicate()[0], 'utf-8')

    proc.wait()

    if proc.returncode != 0:
        raise RuntimeError("ffprobe: nonzero exit status ({})"
            .format(proc.returncode))

    kv = {}

    tag = None
    tgt = None

    for line in out.split("\n"):
        line = line.strip()

        m = re.match("^\[([^/][^\]]+)\]$", line)
        if m:
            tmp = m.group(1)

            if tag != None:
                continue

            if tmp == "FORMAT":
                tgt = kv

            elif tmp == "STREAM":
                tgt = {}

            tag = tmp

            continue

        m = re.match("^\[/([^\]]+)\]$", line)
        if m:
            tmp = m.group(1)

            if tag != tmp:
                continue

            if tmp == "STREAM":
                if "index" in tgt:
                    if not "__streams__" in kv:
                        kv["__streams__"] = []

                    l = kv["__streams__"]
                    i = int(tgt["index"])

                    if i > (len(l) - 1):
                        l.extend([None for x in range(len(l), i + 1)])

                    kv["__streams__"][i] = tgt

            tag = None
            tgt = None

            continue

        m = re.match("^([^=]+)=(.+)$", line)
        if m:
            key = m.group(1)
            val = m.group(2)

            if tgt != None:
                m = RE_INT.match(val)
                if m:
                    tgt[key] = int(val)
                    continue

                m = RE_HEX.match(val)
                if m:
                    tgt[key] = int(val, 16)
                    continue

                m = RE_FLT.match(val)
                if m:
                    tgt[key] = float(val)
                    continue

                m = RE_RAT.match(val)
                if m:
                    nom = float(m.group(1))
                    den = float(m.group(2))

                    if den == 0:
                        tgt[key] = 0 # NaN might be better here
                    else:
                        tgt[key] = nom/den

                    continue

                tgt[key] = val

            continue

    return kv

# SI prefix (largest first)
SI = (("G", 9), ("M", 6), ("k", 3), ("", 0), ("m", -3), ("u", -6), ("n", -9))

def prefix(n, p=3, exact=False):
    s = n < 0
    n = abs(n)

    for i, si in enumerate(SI):
        pr, pw = si
        tmp = n/(10**pw)
        if tmp > 1:
            break

    # special case
    if (tmp == 1000.0) and (i < (len(SI) - 1)):
        pr, pw = SI[i + 1]
        tmp = n/(10**pw)

    if not exact:
        if tmp < 1:
            return "%s<1%s" % ("-" if s else "", SI[-1][0])
        elif tmp > 999:
            return "%s>999%s" % ("-" if s else "", SI[0][0])

    return "%s%.*g%s" % ("-" if s else "", p, tmp, pr)

def progress(method, up, up_size, down, down_size, speed, state):
    print("\x1B[2K\r    ", end="", file=sys.stderr)
    if state == 0:
        print("{}: Initializing...".format(method),
            end="", flush=True, file=sys.stderr)

    elif state == 1:
        print("{}: -> {}B/{} at {}...".format(
            method, prefix(up),
            "<unknown>" if up_size == -1 else prefix(up_size) + "B",
            "<wait>" if speed == 0 else prefix(speed) + "B/s"),
                end="", flush=True, file=sys.stderr)

    elif state == 2:
        print("{}: <- {}B/{} at {}...".format(
            method, prefix(down),
            "<unknown>" if down_size == -1 else prefix(down_size) + "B",
            "<wait>" if speed == 0 else prefix(speed) + "B/s"),
                end="", flush=True, file=sys.stderr)

    elif state == 3:
        print("{}: Total ".format(method), end="", file=sys.stderr)
        if up > 0:
            print("{}B up, ".format(prefix(up)), end="", file=sys.stderr)
        print("{}B down.".format(prefix(down)), file=sys.stderr)

    elif state == 4:
        print("Error.", file=sys.stderr)

class DataSource:
    data = None
    mode = None
    size = None

    speed = None
    xferd = None
    tx_old = None
    ts_old = None
    stats = None
    interval = None
    chunk_size = None

    def __init__(self, data, stats, interval, chunk_size):
        if hasattr(data, "read"):
            self.mode = 0
            self.data = data
            pos = data.tell()
            tmp = data.seek(0, 2)
            if (tmp == 0) and (len(data.peek(1)) > 0):
                self.size = -1
            else:
                self.size = tmp
            data.seek(pos)

        elif isinstance(data, bytes):
            self.mode = 1
            self.data = bytearray(data)
            self.size = len(data)

        elif isinstance(data, str):
            self.mode = 1
            self.data = bytearray(bytes(data, "utf-8"))
            self.size = len(self.data)

        else:
            raise RuntimeError("Invalid data type. ({})".format(type(data)))

        self.xferd = 0
        self.tx_old = 0
        self.speed = 0
        self.stats = stats
        self.interval = interval
        self.chunk_size = chunk_size

    def __iter__(self):
        self.ts_old = int(time.time()*1000)
        return iter(self.get, None)

    # required to avoid chunked encoding
    def __len__(self):
        return self.size

    def get(self):
        if self.mode == 0:
            chunk = self.data.read(self.chunk_size)

        elif self.mode == 1:
            i = min(len(self.data), self.chunk_size)
            chunk = self.data[:i]
            del self.data[:i]

        if len(chunk) < 1:
            return None

        self.xferd += len(chunk)

        now = int(time.time()*1000)

        if (now - self.ts_old) > self.interval:
            self.speed = 1000*(self.xferd - self.tx_old)/(now - self.ts_old)
            self.tx_old = xferd
            self.ts_old = now

            if self.stats:
                self.stats(self)

        return chunk

class ZlibDecompressor:
    fp = None

    def __init__(self, fp):
        self.fp = fp;
        self.comp = zlib.decompressobj()

    def read(self, size=None):
        out = bytearray()

        while (size < 1) or (len(out) < size):
            chunk = self.fp.read(1024)
            if len(chunk) < 1:
                break
            out += self.comp.decompress(chunk, size - len(out))

        return bytes(out)

CIPHERS = "ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384"

class TLSAdapter(HTTPAdapter):
    def __init__(self, ssl_options=0, **kwargs):
        self.ssl_options = ssl_options
        super(TLSAdapter, self).__init__(**kwargs)

    def init_poolmanager(self, *pool_args, **pool_kwargs):
        ctx = create_urllib3_context(
            ciphers=CIPHERS,
            cert_reqs=ssl.CERT_REQUIRED,
            options=self.ssl_options)
        self.poolmanager = PoolManager(*pool_args,
            ssl_context=ctx, **pool_kwargs)

# attempt to bypass CDN bot filters by mimicing browser TLS stack
# (doesn't seem to be an issue on content.echo360.org.uk at the moment)
def get_session():
    s = requests.session()
    s.mount("https://", TLSAdapter(ssl.OP_NO_TLSv1 | ssl.OP_NO_TLSv1_1))
    return s

def request(url, dst=None, data=None, stats=None, s=None, interval=500, chunk_size=1024):
    state = None

    # create new session if none specified
    if s == None:
        s = session()

    try:
        src = None

        # implicitly use POST if we have to send data
        if data != None:
            method = "POST"
            if type(data) in [list, tuple]:
                args = {"data": data}
                data_size = 0
            else:
                src = DataSource(data, lambda src: stats( \
                    method, src.xferd, len(src), -1, -1, src.speed, state), \
                        interval, chunk_size)
                if len(src) < 0:
                    raise RuntimeError("POST data size couldn't be determined.")
                args = {"data": src}
                data_size = len(src)
        else:
            method = "GET"
            args = {}
            data_size = 0

        state = 0

        if stats:
            stats(method, -1, -1, -1, -1, -1, state)

        state = 1
        
        #r = s.request(method, url, stream=True, 
        #    headers={"accept-encoding": "gzip"}, **args)
        r = s.request(method, url, stream=True, headers={"User-Agent": UA}, **args) 
        if src:
            data_size = src.xferd
        r.raise_for_status()

        fp = r.raw
        #try:
        #    if r.headers["content-encoding"] == "gzip":
        #        fp = ZlibDecompressor(r.raw)
        #except KeyError:
        #    pass

        state = 2

        if dst == None:
            dst = bytearray()
            write = False
        else:
            write = True

        xferd = 0 
        speed = 0
        try:
            total = int(r.headers["content-length"])
        except KeyError:
            total = -1

        tx_old = 0
        ts_old = int(time.time()*1000)

        while 1:
            chunk = fp.read(chunk_size)
            if len(chunk) == 0:
                break

            xferd += len(chunk) 

            now = int(time.time()*1000)
            if (now - ts_old) > interval:
                speed = 1000*(xferd - tx_old)/(now - ts_old)
                tx_old = xferd
                ts_old = now

                if stats:
                    stats(method, data_size, data_size, xferd, total, speed, state)

            if write:
                dst.write(chunk)
            else:
                dst += chunk

        state = 3

        if stats:
            stats(method, data_size, data_size, xferd, total, speed, state)

        if isinstance(dst, bytearray):
            return bytes(dst)
        else:
            return True

    except requests.RequestException:
        state = 4

        if stats:
            try:
                stats(method, data_size, data_size, xferd, total, speed, state)
            except UnboundLocalError:
                stats(method, -1, -1, -1, -1, -1, state)

        #import traceback
        #print(traceback.format_exc())

        if isinstance(dst, bytearray):
            return None
        else:
            return False

# catch-all remove
def remove(path):
    def _raise(x, y, z):
        raise RuntimeError()
        
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except IsADirectoryError:
        try:
            os.rmdir(path)
        except FileNotFoundError:
            pass
        except OSError:
            try:
                shutil.rmtree(path, onerror=_raise)
            except:
                raise RuntimeError( \
                    "remove(): shutil.rmtree() failed") from None
        except:
            raise RuntimeError( \
                "remove(): os.rmdir() failed") from None
    except:
        raise RuntimeError( \
            "remove(): os.remove() failed") from None

global_index = None

def auto_index(hint):
    global global_index

    if global_index == None:
        global_index = 0
        
        for file in sorted(os.listdir()):
            m = RE_IND.match(file)
            if not m:
                continue

            j = int(m.group(0))

            if file.find(hint) != -1:
                break

            if j >= global_index:
                global_index = j + 1

    i = global_index
    global_index += 1

    return i

def main():
    global interrupt

    ret = 0

    files = []
    cookies = {}

    index = 0
    increment = False

    interrupted = False
    errored = False

    # we use a KeyboardInterrupt here as a
    # "goto" to the very end of this block
    try:
        print("Parsing input...")

        try:
            interrupt = True

            for line in sys.stdin:
                line = line[:-1]

                if index == len(files):
                    files.append([None, None, None, []])

                m = RE_SPACE.match(line)
                if m:
                    if increment:
                        index += 1
                    increment = False
                    continue

                m = RE_META.match(line)
                if m:
                    key = m.group(1)
                    val = m.group(2)
                
                    if key == "cookie":
                        tmp_1, tmp_2 = val.split("=", 1)
                        cookies[tmp_1] = tmp_2

                    elif key == "name":
                        files[index][0] = val.replace("/", "-");
                        increment = True

                    elif key == "uuid":
                        files[index][1] = val;
                        increment = True

                    elif key == "index":
                        if val == "auto":
                            # name is required for hint, the extension
                            # should output it before the index
                            if files[index][0] == None:
                                raise RuntimeError("Index before name.")

                            files[index][2] = auto_index(files[index][0])
                        else:
                            files[index][2] = int(val)
                        increment = True

                    continue

                m = RE_STREAM.match(line)
                if m:
                    src = m.group(1)
                    url = m.group(4)
                    s = int(m.group(2))
                    q = int(m.group(3))

                    files[index][3].append([src, url, s, q])

                    increment = True
                    continue

        except KeyboardInterrupt:
            print("  Interrupted.")
            interrupted = True

        finally:
            interrupt = False

        if interrupted:
            raise KeyboardInterrupt()

        print("Selecting highest qualities...")
        for _, _, _, streams in files:
            for _, _, i, q in streams:
                j = 0
                while j < len(streams):
                    _, _, _i, _q = streams[j]

                    if (_i == i) and (_q < q):
                        streams.pop(j)
                    else:
                        j += 1

        # create session with cookies
        session = get_session()
        for key in cookies:
            val = cookies[key]
            session.cookies.set(key, val)

        print("Downloading streams...")
        for name, uuid, index, streams in files:

            print("File[{}]: '{}'".format(index, name))

            for j, stream in enumerate(streams):
                src, url, s, q = stream

                dst = hashlib.md5(bytes(uuid, "utf-8")).hexdigest() \
                    + "-stream-" + str(s) + ".m4s"

                streams[j].append(dst)

                print("  Downloading '{}' ('{}'):".format(dst, src))

                if os.path.isfile(dst):
                    try:
                        # verify integrity with ffprobe
                        run_subprocess([
                            "ffprobe",
                            "-loglevel", "error",
                            dst], False, False)

                        print("    Exists.")
                        continue

                    # this is fine as the stream
                    # will be re-aqcuired
                    except RuntimeError:
                        print("    Exists but corrupt.")

                    except KeyboardInterrupt:
                        print("    Interrupted.")

                        interrupted = True
                        break

                try:
                    interrupt = True

                    with open(dst, "wb") as fp:
                        status = request(url, dst=fp, s=session, stats=progress)

                    if not status:
                        errored = True
                        try:
                            remove(dst)
                        except RuntimeError as e:
                            print("    Error: {}".format(e))

                except KeyboardInterrupt:
                    print("\r    Interrupted.")

                    try:
                        remove(dst)
                    except RuntimeError as e:
                        print("    Error: {}".format(e))

                    interrupted = True
                    break
                
                finally:
                    interrupt = False

            if interrupted:
                break

        if interrupted:
            raise KeyboardInterrupt()

        print("Merging streams...")
        for name, uuid, index, streams in files:
            
            print("File[{}]: '{}'".format(index, name))

            ids = []
            tmp = []

            for stream in streams:
                _, _, q, _, dst = stream

                # if the actual file is missing, don't add anything
                # so that the below code can handle the error
                if not os.path.isfile(dst):
                    continue

                ids.append(q)
                tmp.append(dst)

            bitmap = (0 in ids) | (1 in ids) << 1 | (2 in ids) << 2
      
            # streams missing
            if bitmap in [0, 1, 2, 4, 6]:
                print("  Error: Missing required streams.")
                errored = True
                continue
            
            # 2 streams
            elif bitmap == 3:
                s_scr = tmp[1]
                s_lay = None
                s_snd = tmp[0]

            # 2 streams
            elif bitmap == 5:
                s_scr = tmp[1]
                s_lay = None
                s_snd = tmp[0]

            # 3 streams
            elif bitmap == 7:
                s_scr = tmp[1]
                s_lay = tmp[2]
                s_snd = tmp[0]

            # impossible
            else:
                s_scr = None
                s_lay = None
                s_snd = None

            # we use nice and cpulimit
            # to reduce lag and CPU usage
            cmd = [
                "nice",
                "-n", str(NICENESS),
                "--",
                "cpulimit",
                "-l", str(CPULIMIT),
                "-f", "-m", "-q",
                "--",
                "ffmpeg"
            ]
            cmd.extend(GLOBAL_OPTS)

            out = "{:02} - {}".format(index, name) 

            encode = False

            tmp = [None, None, None]
            
            try:
                for i, src in enumerate([s_snd, s_scr, s_lay]):
                    if not src:
                        continue

                    res = ffprobe(src)

                    if (not "__streams__" in res) \
                        or (len(res["__streams__"]) < 1):
                        raise RuntimeError( \
                            "'{}' doesn't contain any streams.".format(src))

                    elif len(res["__streams__"]) > 1:
                        print("  Warning: '{}' contains " \
                            "multiple streams, using first.".format(src))
                    
                    tmp[i] = res["__streams__"][0]

            except RuntimeError as e:
                errored = True

                print("  Error: {}".format(e))
                continue

            s_0, s_1, s_2 = tmp

            fix_mono = s_0["channel_layout"] != "mono"

            if (s_1["width"] > MAX_WIDTH):
                w_output = MAX_WIDTH
                h_output = MAX_WIDTH*(s_1["height"]/s_1["width"])
                h_output = int(round(h_output / 2) * 2)
            else:
                w_output = s_1["width"]
                h_output = s_1["height"]

            try:
                if s_lay:
                    out += "." + ENCODE_EXT

                    w_scale_to = int(round(w_output*FACTOR / 2) * 2)
                    h_scale_to = int(round(h_output*FACTOR / 2) * 2)

                    if ((w_scale_to > s_2["width"]) \
                        or (h_scale_to > s_2["height"])):
                        w_scale_to = s_2["width"]
                        e_scale_to = s_2["height"]

                    print("  ENCODE (overlay):")
                    print("    sound   : '{}'{}".format( \
                        s_snd, " (stereo -> mono)" if fix_mono else ""))
                    print("    main    : '{}' ({}x{})" \
                        .format(s_scr, s_1["width"], s_1["height"]))
                    print("    overlay : '{}' ({}x{})" \
                        .format(s_lay, s_2["width"], s_2["height"]))
                    print("    output  : '{}' ({}x{},{}x{})" \
                        .format(out, w_output, h_output,
                            w_scale_to, h_scale_to))

                    cmd.extend([
                        "-i", s_snd,
                        "-i", s_scr,
                        "-i", s_lay,
                    ])

                    filter_complex = ""
                    filter_complex += VF_2.format(w_scale_to, \
                            h_scale_to, OVERLAYS[OVERLAY], w_output, \
                            h_output)
                    if fix_mono:
                        filter_complex += ";"
                        filter_complex += AF_1.format(CHANNEL)
                    cmd.extend(["-filter_complex", filter_complex])

                    cmd.extend(VIDEO_CODEC)
                    cmd.extend(AUDIO_CODEC)
                    cmd.extend([
                        "-map", "[vout]",
                        "-map", "[aout]" if fix_mono else "0:0",
                        "-f", ENCODE_CNT
                    ])

                    encode = True

                elif w_output != s_1["width"]:
                    out += "." + ENCODE_EXT
                    print("  ENCODE (downscale):".format(out))
                    print("    sound  : '{}'{}".format( \
                        s_snd, " (stereo -> mono)" if fix_mono else ""))
                    print("    main   : '{}' ({}x{})" \
                        .format(s_scr, s_1["width"], s_1["height"]))
                    print("    output : '{}' ({}x{})" \
                        .format(out, w_output, h_output))

                    cmd.extend([
                        "-i", s_snd,
                        "-i", s_scr
                    ])

                    filter_complex = ""
                    filter_complex += VF_1.format(w_output, h_output)
                    if fix_mono:
                        filter_complex += ";"
                        filter_complex += AF_1.format(CHANNEL)
                    cmd.extend(["-filter_complex", filter_complex])

                    cmd.extend(AUDIO_CODEC)
                    cmd.extend([
                        "-map", "[vout]",
                        "-map", "[aout]" if fix_mono else "0:0",
                        "-f", ENCODE_CNT
                    ])
                    cmd.extend(EXTRA_OPTS);

                    encode = True

                elif FORCE_ENCODE:
                    out += "." + ENCODE_EXT
                    print("  ENCODE (forced):".format(out))
                    print("    sound  : '{}'{}".format( \
                        s_snd, " (stereo -> mono)" if fix_mono else ""))
                    print("    main   : '{}' ({}x{})" \
                        .format(s_scr, s_1["width"], s_1["height"]))
                    print("    output : '{}' ({}x{})" \
                        .format(out, w_output, h_output))

                    cmd.extend([
                        "-i", s_snd,
                        "-i", s_scr,
                    ])

                    if fix_mono:
                        cmd.extend(["-filter_complex", AF_1.format(CHANNEL)])

                    cmd.extend(AUDIO_CODEC)
                    cmd.extend([
                        "-map", "1:0",
                        "-map", "[aout]" if fix_mono else "0:0",
                        "-f", ENCODE_CNT
                    ])
                    cmd.extend(EXTRA_OPTS);

                    encode = True

                else:
                    out += ".mkv"
                    print("  REMUX:")
                    print("    sound  : '{}'".format(s_snd))
                    print("    main   : '{}' ({}x{})" \
                        .format(s_scr, s_1["width"], s_1["height"]))
                    print("    output : '{}' ({}x{})" \
                        .format(out, w_output, h_output))

                    cmd.extend([
                        "-i", s_snd,
                        "-i", s_scr
                    ])
                    cmd.extend([
                        "-codec", "copy",
                        "-map", "1:0",
                        "-map", "0:0",
                        "-f", "matroska"
                    ])
                    cmd.extend(EXTRA_OPTS);

                    encode = False

                if os.path.isfile(out):
                    try:
                        s_out = ffprobe(out)

                        t_1 = s_out["duration"]
                        t_2 = s_1["duration"]

                        if not (t_1.isdigit() and t_2.isdigit()) \
                            or (abs(t_1 - t_2) > MAX_DURATION_MISMATCH):
                            print("  Exists but duration doesn't match.")

                        else:
                            print("  Exists.")
                            continue

                    # this is fine, as we'll just re-encode/remux
                    except RuntimeError:
                        print("  Exists but corrupt.")

                    # remove file
                    print("  Removing '{}'.".format(out))
                    remove(out)

                if DUAL_PASS and encode:
                    pass_1 = cmd[:]
                    pass_2 = cmd[:]
                    pass_1.extend(["-pass", "1", "/dev/null"])
                    pass_2.extend(["-pass", "2", out])

                    print("  Pass 1:")
                    run_subprocess(pass_1)
                    print("  Pass 2:")
                    run_subprocess(pass_2)
                else:
                    cmd.append(out)

                    run_subprocess(cmd)

            except KeyboardInterrupt:
                print("  Interrupted.")

                try:
                    remove(out)
                except RuntimeError as e:
                    print("  Error: {}".format(e))

                interrupted = True

                break

            except RuntimeError as e:
                errored = True

                print("  Error: {}".format(e))

                try:
                    remove(out)
                except RuntimeError as e:
                    print("  Error: {}".format(e))

                continue

            finally:
                # remove all ffmpeg2pass files
                for file in os.listdir():
                    if file.startswith("ffmpeg2pass"):
                        try:
                            remove(file)
                        except RuntimeError as e:
                            print("  Error: {}".format(e))

        if interrupted:
            raise KeyboardInterrupt()

        if errored:
            print("Not cleaning up due to errors.")
            ret = 1

        else:
            print("Cleaning up...")
            for _, _, _, streams in files:
                for stream in streams:
                    try:
                        remove(stream[4])
                    except RuntimeError as e:
                        print("  Error: {}".format(e))

    # we goto here
    except KeyboardInterrupt:
        ret = 127
        pass

    print("Done.")

    return ret

if __name__ == "__main__":
    sys.exit(main())
