# தமிழ் TV — Tamil IPTV player

A web page that plays live Tamil TV channels and works like a TV: channel numbers, channel up/down, an info banner, a TV guide and favorites. Plain HTML, CSS and JavaScript, with no build step.

## Run it

Serve the folder with any static web server. For example:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Features

- **Tamil channels:** loads the free [iptv-org](https://github.com/iptv-org/iptv) Tamil playlist, plus Nijayam TV.
- **Channel list:** hidden while you watch. Open it with **☰ List** or `G`, or by moving the mouse to the left edge. It has category tabs, search, and the program that's on now.
- **Hidden channels:** channels without Tamil audio (Discovery, Cartoon Network, Sony and others) are hidden by default. Hide any other channel with ⊘ or `X`, and bring channels back in ⚙ Settings.
- **TV guide:** XMLTV guide data from epg.pw. Shows Now/Next in the banner, plus a full guide grid (`E`).
- **Audio language:** the 🗣 button or `A` switches language when a stream has several. Tamil is picked automatically when available.
- **Your own channels:** add any stream link with **＋**, or load your own M3U playlist in ⚙ Settings.
- **TV controls:** type a channel number, use ↑/↓ for channel up/down, `L` for the previous channel, `S` to favorite, `F` for fullscreen and `H` for all shortcuts.
- **Playback:** hls.js and mpegts.js load from a CDN, with the browser's native player as a fallback.

## Note

Streams come from public sources. Some may be offline or geo-blocked, and those show “No Signal”.
