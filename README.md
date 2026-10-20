# Music Assistant TV

A [Music Assistant](https://music-assistant.io) app for Samsung TVs (Tizen). It shows what's
playing on the TV and can make the TV a speaker of its own:

- **Now playing:** big album art, title, artist, progress and what's up next, with the
  background and accent color taken from the artwork.
- **Karaoke:** synced lyrics fill the screen and follow the song, whenever Music Assistant has
  synced (LRC) lyrics for it (for example from its LRCLIB provider).
- **Party mode:** the party QR code for guests, the current song with request and boost badges,
  what's coming up, and karaoke lyrics, from Music Assistant's Party plugin.
- **Cast from Music Assistant:** the TV registers as a dashboard display, so "Cast" in
  Music Assistant can put the party or now-playing screen on it.
- **TV speaker:** the TV joins Music Assistant as a [Sendspin](https://www.sendspin-audio.com/)
  player that plays in sync with your other speakers, with an adjustable sync delay.
- **Remote control:** no phone needed once it's set up.

| Button | Does |
| --- | --- |
| OK, Play/Pause | Pause or resume |
| ◀ ▶, Previous/Next | Previous or next song |
| ▲ ▼ | Volume of the player shown (the TV's own volume buttons stay the TV's) |
| Red | Choose which player to show: automatic, this TV, or any player or group |
| Green | Lyrics on or off |
| Yellow | Party mode on or off |
| Blue | Settings: TV speaker on or off, sync delay, sign out |
| Back, twice | Close the app |

The color buttons are on Samsung's standard remote; on the Smart Remote they're behind the
"123" button.

## Installing on the TV

Samsung TVs only install store apps unless Developer Mode is on. Either way below starts there:

1. On the TV, open **Apps**, then type **1 2 3 4 5** on the remote. Turn **Developer mode** on,
   enter the address of your computer as the Host PC IP, and restart the TV.

### Through TizenBrew (no developer tools)

[TizenBrew](https://github.com/reisxd/TizenBrew) is a small launcher for community TV apps. It is
installed once from a computer with its GUI installer, which also takes care of Samsung's signing
certificate (2023 and newer TVs ask you to sign in to a Samsung account for it).

2. On your computer, run **TizenBrew Installer** from its
   [releases](https://github.com/reisxd/TizenBrew/releases) and select **Install TizenBrew**.
3. On the TV, open TizenBrew and press the **green** button for the Module Manager. Choose
   **Add GitHub Module**, type **`samuelcomplex/ma-tizen`**, and press Done. Then open
   **Music Assistant TV** from TizenBrew's list.

### As a regular app (.wgt)

`MusicAssistantTV.wgt` from the [latest release](../../releases/latest) is a standard Tizen web
app. Install it with Samsung's Tizen tools (the Tizen extension for VS Code, or Tizen Studio),
which sign it with your Samsung certificate for your TV.

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
npm run build     # build/app and build/MusicAssistantTV.wgt (unsigned)
npm run module    # the TizenBrew module files in module/
```

Opening `build/app/index.html` from a local web server in Chrome works for development; R, G, Y
and B stand in for the color buttons and Escape for Back.

To publish a release, open **Actions > Build > Run workflow** and enter a version such as
`v0.2.0`. That builds the app, updates `module/` for TizenBrew, and creates the release with the
`.wgt`.

## License

Apache License 2.0, see [LICENSE](LICENSE). Bundled libraries are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Not affiliated with Music Assistant, the Open Home Foundation or Samsung.
