# Audio Codex

A Foundry VTT module that turns the audio in your storage into a searchable, folder-tree
library, and builds playlists from it by drag and drop.

Foundry only knows about audio that already sits in a playlist. Audio Codex indexes whole
folders across User Data, S3 and The Forge, so a collection of thousands of tracks becomes
something you can browse, search and reuse.

## Features

- **Library roots**: index one or more folders from `data`, `s3` or `forgevtt` file sources.
- **Folder tree** of `aac`, `flac`, `m4a`, `mid`, `mp3`, `ogg`, `opus`, `wav` and `webm`
  files, with title, artist, album, track number and duration read from their tags.
- **Search** across name, path, artist, album and title.
- **Tag overrides**: set artist or album for a whole folder, or revert to the file's tags.
  Overrides are stored separately and survive every sync.
- **Cover art** from `cover.*`/`folder.*` images beside the tracks. Album folders without
  one get their embedded artwork extracted and saved as `cover.jpg`/`cover.png`.
- **Playlist panel**: create, rename, delete and set covers on playlists, and remove sounds,
  without leaving the library. Cover art also appears in the core Playlists sidebar.
- **Drag and drop** tracks or folders onto a playlist in the panel or the sidebar.
  Duplicates are skipped. Right-click a folder to create a playlist from it.
- **Upload** by dropping an OS folder onto a library folder (User Data and S3 roots).
- **Sync** picks up new files and only reads tags for paths it has not seen. A full rescan
  re-reads everything.
- **Relink playlists** refreshes cover art on existing playlists and their sounds from the
  library.

Audio Codex never deletes, moves or renames stored files; Foundry's file API cannot.
It does not play audio itself; playback stays with core playlists.

## Requirements

Foundry VTT v14.

## Installation

There are no packaged releases yet; build and install manually.

1. Build the module (needs Node and pnpm):

   ```sh
   git clone https://github.com/tasandberg/audio-codex.git
   cd audio-codex
   pnpm install
   pnpm build
   ```

2. Create `Data/modules/audio-codex/` in your Foundry user data folder and copy in
   `module.json`, `dist/`, `lang/` and `templates/`.
3. Restart Foundry, then enable **Audio Codex** in your world's **Manage Modules**.

To update, pull, rebuild and copy the same files again, then reload every open Foundry tab.

## Usage

See the [user guide](docs/guide.md) for everything below in detail.

1. **Configure Settings → Audio Codex → Configure Roots**. Add a root per folder to index,
   choosing a file source, a bucket for S3, and a folder.
2. Open the library from the **Audio Codex** button in the Playlists sidebar.
3. As GM, click **Sync new files**. The first sync reads every file's tags; later syncs only
   read new ones.
4. Drag tracks or folders onto a playlist.

The index is a gzipped JSON file in User Data. Players load it over plain HTTP, so they see
the library read-only without any file-browse permission.

## S3 notes

- Tags and embedded covers are read with ranged `GET` requests from the browser. The bucket
  needs CORS allowing your Foundry origin and the `Range` header, and must return
  `206 Partial Content`.
- Objects must be publicly readable, as for any audio Foundry plays from S3.
- Cover extraction and uploads need write access to the bucket through Foundry's S3
  configuration.

## Development

```sh
pnpm install
pnpm dev        # vite build --watch; reload the browser after each rebuild
pnpm build
pnpm test
pnpm typecheck
```

Link or bind-mount the repository into your Foundry `Data/modules/audio-codex` folder.
`scripts/make-fixtures.sh` regenerates the synthetic test audio (needs ffmpeg).

## License

[MIT](LICENSE)
