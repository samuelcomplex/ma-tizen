# Music Assistant TV

A [Music Assistant](https://music-assistant.io) app for Samsung TVs (Tizen). It shows what's
playing on the TV and can make the TV a speaker of its own:

- **Now playing:** big album art, title, artist, progress and what's up next, over a flowing
  blurred album-art background. An optional "liquid" background (flowing album art drawn by the
  TV's graphics chip, pulsing with the music while the TV plays along) can be switched on in the
  menu; it is off by default because it is too heavy for modest TVs such as the 2024 Q60D. If the
  screen can't keep up, the app steps it down by itself (and finally to the simple background)
  and remembers where it settled. New songs slide in.
- **Karaoke:** synced lyrics fill the screen and follow the song, whenever Music Assistant has
  synced (LRC) lyrics for it (for example from its LRCLIB provider). Lines fill in as they're
  sung, word by word when the lyrics have word timing, with a count-in before the first line and
  dots through instrumental breaks.
- **Party mode:** the party QR code for guests, the current song with request and boost badges,
  what's coming up, a ticker along the bottom, and karaoke lyrics, from Music Assistant's Party
  plugin. A guest's song gets a banner when it starts, and a boosted one gets confetti.
- **Music quiz:** host Music Assistant's Music Quiz from the TV (Menu > Music quiz). Guests scan
  the code, pick a name and answer on their phones; the TV shows the lobby, a countdown, the
  answers and a scoreboard, and ends on a podium. The quiz takes over the party player, so the
  TV saves the queue first and puts the music back afterwards. With **Random quizzes:
  Sometimes**, a quiz now and then announces itself in a corner card and starts when the song
  ends, if anyone joined. Needs the Music Quiz plugin turned on in Music Assistant.
- **Party extras** (Menu > Party extras, each one can be turned off): a small scan-to-add card
  now and then (and while the queue is nearly empty), party stats pop-ups, an up-next countdown
  in the last 15 seconds of a song, a flash and sparks when the beat drops, and dance-offs when
  a dance song is in full swing.
- **Lights with LedFx** (Menu > Party extras > Lights (LedFx)): [LedFx](https://www.ledfx.app)
  does the audio analysis and the effects; the TV switches its scenes for what's happening: one
  for music playing, a drop, a dance-off, a quiz and nothing playing. See "Lights with LedFx"
  below.
- **Lights, WLED directly** (Menu > Party extras > Lights (WLED directly)): WLED lights follow the
  album colors and the TV's sound without LedFx. The TV finds them on your network and gives them
  their old state back afterwards.
- **Cast from Music Assistant:** the TV registers as a dashboard display, so "Cast" in
  Music Assistant can put the party or now-playing screen on it.
- **TV speaker:** the TV joins Music Assistant as a [Sendspin](https://www.sendspin-audio.com/)
  player that plays in sync with your other speakers, with an adjustable sync delay. While it
  plays, a visualizer moves with the music: bars, a wave, or a ring around the album art (which
  then turns like a record). **Visuals only** keeps the TV silent but still playing along, so the
  visuals work while your other speakers make the sound: group the TV with them in Music
  Assistant. **Settings > Speaker status** shows what the TV's audio is doing (connection, audio
  engine, stream format, sync error, screen speed) and a log of recent events, for troubleshooting.
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

## Lights with LedFx

LedFx 2.2 can join Music Assistant as a Sendspin player, so it hears whatever your speakers play
and drives your lights with its own effects. The TV doesn't send it audio; it only tells LedFx
what's going on by switching scenes.

1. In LedFx, add a Sendspin server (Settings > Audio): `ws://<your Music Assistant>:8927/sendspin`.
   Then pick it as the audio input and restart LedFx. "LedFx" appears as a player in Music
   Assistant.
2. Make a few scenes in LedFx (for example everyday, drop, dance-off, quiz, off).
3. On the TV: **Menu > Party extras > Lights (LedFx)**. Switch it on, select **LedFx address** to
   search your network, and pick a scene for each moment. OK on a scene row tries it. The row
   **LedFx in the party** adds LedFx to the speakers that are playing, so it hears the music.

Drops and dance-offs are detected from the TV's own sound, so those scenes need the TV to play
along (sound or Visuals only). The everyday, quiz and nothing-playing scenes work with any player.
Turning on LedFx turns off direct WLED sync, and the other way round.

If the TV says LedFx refused it, add the origin it shows to `allowed_origins` in LedFx's config.
Home Assistant's LedFx integration only controls LedFx and takes no audio, and WLED's own audio
sync needs UDP, which a TV app can't send, so LedFx is the way to get real audio-reactive lights.

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
