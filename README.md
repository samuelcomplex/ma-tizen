# Music Assistant TV

A [Music Assistant](https://music-assistant.io) app for Samsung TVs (Tizen). It shows what's
playing on the TV and can make the TV a speaker of its own:

- **Now playing:** big album art, title, artist, progress and what's up next, over a flowing
  "liquid" background made from the album art and drawn by the TV's graphics chip; it pulses
  with the music while the TV plays along. New songs slide in.
- **Karaoke:** synced lyrics fill the screen and follow the song, whenever Music Assistant has
  synced (LRC) lyrics for it (for example from its LRCLIB provider). Lines fill in as they're
  sung, word by word when the lyrics have word timing, with a count-in before the first line and
  dots through instrumental breaks.
- **Party mode:** the party QR code for guests, the current song with request and boost badges,
  what's coming up, a ticker along the bottom, and karaoke lyrics, from Music Assistant's Party
  plugin. A guest's song gets a banner when it starts, and a boosted one gets confetti.
- **Cast from Music Assistant:** the TV registers as a dashboard display, so "Cast" in
  Music Assistant can put the party or now-playing screen on it.
- **TV speaker:** the TV joins Music Assistant as a [Sendspin](https://www.sendspin-audio.com/)
  player that plays in sync with your other speakers, with an adjustable sync delay. While it
  plays, a visualizer moves with the music: bars, a wave, or a ring around the album art (which
  then turns like a record). **Visuals only** keeps the TV silent but still playing along, so the
  visuals work while your other speakers make the sound: group the TV with them in Music
  Assistant.
- **Clock:** when nothing is playing the TV shows a large clock, and the layout shifts a little
  every few minutes to avoid burn-in.
- **Remote control:** no phone needed once it's set up. Volume and pause show on screen.

| Button | Does (Standard preset) |
| --- | --- |
| OK | Menu: pause or play, party mode, lyrics, which player to show, settings |
| Play/Pause | Pause or resume |
| ◀ ▶ | Previous or next song |
| ▲ ▼ | Volume of the player shown (the TV's own volume rocker stays the TV's) |
| Channel rocker up/down | Switch between now playing and party mode |
| Pressing the channel rocker | Lyrics on or off |
| Back | Close the menu; press twice to close the app |

**Settings > Remote buttons** changes what ◀ ▶, ▲ ▼ and the channel rocker do, with presets
(Standard; Fixed volume, for speakers with their own volume control; Channel skips) or your own
choice per button: skip songs, volume, seek 10 seconds, party mode, lyrics, pause, pick player or
nothing. The hint bar along the bottom follows what you set.

Remotes with color buttons (or the colors behind the Smart Remote's "123" button) also get
shortcuts: Red picks the player, Green turns lyrics on or off, Yellow switches party mode, Blue
opens settings.

## Installing on the TV

The app installs as a normal TV app, so it sits in your Apps list and opens like any other.
[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) installs it from a Windows, Mac,
Linux or Android device and takes care of Samsung's signing certificate.

1. Download `MusicAssistantTV.wgt` from the [latest release](../../releases/latest).
2. On the TV, turn on Developer mode: open **Apps**, then **App Settings**, and type **1 2 3 4 5**
   on the remote. Turn **Developer mode** on, enter your computer's address as the **Host PC IP**,
   and restart the TV by holding the power button until the Samsung logo appears.
3. In Apps2Samsung, pick your TV, choose to install a custom `.wgt`, and select the file. On 2023
   and newer TVs it asks you to sign in to a Samsung account once, for the certificate.
4. Open **Music Assistant TV** from the TV's Apps.

Updating works the same way: install the newer `.wgt` over the old one. Your settings stay.

## First start

1. The app searches your network for Music Assistant and lists what it finds. If it finds
   nothing, type Music Assistant's address (for example `192.168.1.20`).
2. Sign in with your Music Assistant username and password. The TV stays signed in; you can
   sign out from Settings (Blue).
3. The TV appears in Music Assistant as the player "Samsung TV". Play something on it, or on any
   other player, and the app shows it.

## Sync

The TV speaker uses [sendspin-js](https://github.com/Sendspin/sendspin-js), the Sendspin authors'
own player library (the same one Music Assistant's web player uses), with its clock sync and
drift correction. What it can't measure is the delay the TV and anything after it (a soundbar,
an AV receiver over ARC) add after the audio leaves the app. If the TV plays late compared to
your other speakers, open **Settings** (Blue), select **Sync delay**, and raise it with ▶ while
music plays until it lines up. The setting applies straight away and is kept. The TV's game mode
or a soundbar's "lip sync" setting changes that delay, so set it again after changing those.

## Requirements

- A Samsung TV on Tizen 5.5 or newer (2020 models and later). Developed for a 2024 Q60D
  (Tizen 8).
- Music Assistant 2.10 or newer, with Sendspin (on by default). Party mode needs the Party
  plugin, with guest access on for the QR code.

## Building

```sh
npm install
npm run build     # build/app and build/MusicAssistantTV.wgt (unsigned; Apps2Samsung signs it)
```

Opening `build/app/index.html` from a local web server in Chrome works for development; R, G, Y
and B stand in for the color buttons and Escape for Back.

To publish a release, open **Actions > Build > Run workflow** and enter a version such as
`v0.2.0`. That builds the app and creates the release with the `.wgt`.

## License

Apache License 2.0, see [LICENSE](LICENSE). Bundled libraries are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Not affiliated with Music Assistant, the Open Home Foundation or Samsung.
