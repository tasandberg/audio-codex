# Audio Codex user guide

- [Opening the library](#opening-the-library)
- [Library roots](#library-roots)
- [Syncing](#syncing)
- [Browsing and searching](#browsing-and-searching)
- [Editing tags](#editing-tags)
- [Playlists](#playlists)
- [Cover art](#cover-art)
- [Uploading](#uploading)
- [Access, GMs and players](#access-gms-and-players)
- [Troubleshooting](#troubleshooting)

## Opening the library

Open the **Playlists** sidebar tab and click **Audio Codex** in its header. The window has
four areas: a search box, a toolbar, the **Playlists** panel on the left and the library
tree on the right. The button only appears for users the access setting admits, which by
default is Gamemasters only — see [Access, GMs and players](#access-gms-and-players).

## Library roots

A root is a storage folder the library indexes. Configure roots in **Configure Settings →
Audio Codex → Configure Roots**, or with the folder-tree button in the library toolbar
(GM only).

For each root:

- **Name**: the label shown at the top of the tree.
- **Source**: the Foundry file source. `data` (User Data) and `s3` appear when Foundry has
  them configured; `forgevtt` appears when running on The Forge.
- **Bucket**: required for `s3` roots. Leave it on **No bucket** for other sources.
- **Folder**: the folder inside that source. **Browse** opens Foundry's file picker and fills
  in source, bucket and folder for you.

Click **Add root** for another, the trash button to remove one, then **Save roots**.
After changing roots the toolbar shows *Library is out of date with its roots. Refresh to
sync.* until the next sync.

Any folder containing a file named `noscan.txt` is skipped, along with everything below it.

### S3 requirements

Audio Codex reads tags and embedded artwork straight from the browser with ranged `GET`
requests, so the bucket must:

- allow CORS from your Foundry origin, including the `Range` request header;
- answer ranged requests with `206 Partial Content`;
- serve the audio publicly, as Foundry already needs for S3 playback.

Writing cover images and uploading files goes through Foundry's own S3 configuration, so the
credentials Foundry uses need write access to the bucket.

## Syncing

Only a GM can sync. The first time a GM opens the library in a session, a sync starts
automatically. The toolbar also has:

- **Sync new files** (rotate icon): crawls every root, reads tags for files not seen before
  and keeps the rest from the previous index.
- **Full rescan: re-read every file's tags** (spinning arrows): the same crawl, but re-reads
  every file.

While a sync runs, the toolbar shows its phase (*Scanning folders*, *Reading tags*,
*Extracting covers*, *Writing index*) with **Pause**, **Resume** and **Cancel** buttons.
Cancelling leaves the previous library unchanged.

When it finishes, a notification reports new, unchanged, cover and unreadable counts.
Unreadable files stay in the tree and are retried on the next sync. If a root cannot be
read at all, its previous contents are kept and you are warned.

Sync never deletes, moves or renames stored files. If nothing changed, the index file is
not rewritten.

### Cover extraction

After tags are read, sync looks for **album folders** that have no image file. An album
folder is one whose tracks all share the same album tag. For each, it reads the embedded
picture from the first track and saves it beside the tracks as `cover.jpg` or `cover.png`.
Folders that are not albums are never probed. Albums without embedded art are checked
again on every sync. Forge roots skip this step.

### Where the index lives

The index is a gzipped JSON file at `worlds/<world-id>/audio-codex/index.json` in User Data.
Library roots and tag edits are stored in world settings, so a sync never overwrites edits.

## Browsing and searching

Folders expand with a click on their row. An album folder shows its cover, album title,
artist and track count; the original folder name appears underneath when it differs.
Other folders show a folder icon. Within a folder, subfolders come first, then tracks.

Columns are **Title**, **Artist**, **Album**, **#** (track number) and **Time**. Click a
column header to sort tracks by it; click again to reverse. The default is track number.

Type in the search box to search file name, path, artist, album and title. Every word must
match. Results are a flat list with each track's folder path; the toolbar shows the match
count, and results stop at 250 (*First 250 matches*). Clear the box to return to the tree.

## Editing tags

GMs can double-click a track's **Title**, **Artist**, **Album** or **#** cell to edit it.
**Enter** or clicking away saves; **Escape** cancels. Edited tracks are highlighted.

Right-click a folder for **Set artist for everything here** or **Set album for everything
here**, which apply to every track below it. Right-click an edited track and choose
**Revert to file tags** to drop your edits.

Edits are stored separately from the index and survive every sync and full rescan. They
never change the audio files.

## Playlists

The **Playlists** panel lists the playlists you can see, in the same order as the sidebar,
with their cover and number of sounds. Click a playlist to expand its sounds.

### Adding tracks

- **Drag** a track or folder from the tree onto a playlist in the panel, or onto a playlist
  in the core Playlists sidebar. A folder adds every track beneath it. The target highlights
  while you drag.
- **Right-click a folder → Create playlist** makes a new playlist from every track beneath
  it, named after the album (or the folder), with the folder's cover.
- The **+** button in the panel header creates an empty playlist.

Tracks already in the playlist are skipped silently. New sounds are added at the end. You
can only drop onto playlists you own.

### Managing playlists

Right-click a playlist in the panel:

- **Rename** (or double-click the playlist).
- **Set cover**: choose any image with the file picker.
- **Use library art**: remove a custom cover and fall back to the library's art. Shown only
  when a custom cover is set.
- **Delete playlist**: the same confirmation as the sidebar's Delete.

Right-click a sound and choose **Remove from playlist** to delete it.

All of these are ordinary Foundry document changes, so the sidebar updates too. Audio Codex
does not play audio; use the Playlists sidebar for playback.

## Cover art

Cover art is always an image file stored beside the tracks. In each folder, the first match
wins:

1. an image named `cover` (`cover.jpg`, `cover.png`, …);
2. an image named `folder`;
3. the alphabetically first image (`gif`, `jpeg`, `jpg`, `png`, `webp`).

A subfolder without its own image uses its parent's. Album folders with no image get one
from [cover extraction](#cover-extraction).

Playlists and sounds remember their cover when they are created or dropped, and the art also
appears in the core Playlists sidebar, including the currently playing track. A sound
without its own cover shows the playlist's. A playlist without a cover shows the art of
its first sound that has any.

### Relink playlists

**Relink playlists** (link icon, GM only) refreshes the stored covers of every playlist you
own from the current library. Sound covers are updated or cleared to match their tracks.
A playlist with no cover gets its first track's art. A playlist cover that is a `cover.*`
image inside a library folder, but no longer that folder's chosen cover, is replaced or
removed. Any other custom cover picked with **Set cover** is left alone. The notification
reports sounds updated, playlists changed, and sounds whose file is not in the library
(*unmatched*).

## Uploading

GMs can drop a folder (or files) from their computer onto a folder or track in the tree.
Files go into that folder, keeping the dropped folder structure. Only audio files and one
cover image per folder are uploaded, and only to `data` and `s3` roots.

Progress shows as *Uploading* in the toolbar with **Pause**, **Resume** and **Cancel**.
The new tracks appear straight away, and cover extraction runs for the folders you added.
Files uploaded before a cancel appear after the next sync. You cannot upload while a sync
is running.

## Access, GMs and players

**Configure Settings → Audio Codex → Who can use Audio Codex** sets the lowest role that
gets the module. The four scopes are cumulative:

- **Gamemasters only** — the default
- **Assistant Gamemasters and up**
- **Trusted Players and up**
- **Everyone**

Below the chosen scope there is no Audio Codex at all: no **Audio Codex** button in the
Playlists sidebar header, no library window, and no index request — not an empty library.
Changing the scope takes effect on every connected client straight away, closing the window
for anyone who just lost access. Cover art already stored on a playlist or sound stays
visible in the sidebar, because that art is a flag on the document rather than something the
library serves.

Only a Gamemaster can change this setting. That is enforced in the client, which covers the
settings UI and `game.settings.set()` from the console on every client. It is not enforced
by the server: Foundry's own **Modify Configuration Settings** permission still allows
Assistants by default, so a user who crafts their own socket message can get past it. For
lockdown the server enforces, set **Configure Settings → Configure Permissions → Modify
Configuration Settings** to Gamemaster.

Inside the chosen scope, what a user can do still depends on their role. *GM* below means
Assistant Gamemaster or Gamemaster:

| | GM | Player |
|---|---|---|
| Browse and search the library | yes | yes |
| See cover art in the library and sidebar | yes | yes |
| Sync, rescan, relink, configure roots | yes | no |
| Edit tags, upload | yes | no |
| Create playlists | yes | if allowed to create playlists |
| Drop onto, rename, set cover, remove sounds, delete | playlists they own | playlists they own |

Permitted players load the index over plain HTTP and need no file-browse permission.

## Troubleshooting

**Nothing changed after updating the module.** Reload the browser page so Foundry loads the
new code.

**The library is empty.** Check that roots are configured, then click **Sync new files** as
GM. Players see nothing until a GM has synced.

**A player has no Audio Codex button.** They are below the access scope. Raise **Configure
Settings → Audio Codex → Who can use Audio Codex**; it defaults to Gamemasters only.

**Many S3 files are reported unreadable.** The bucket is missing CORS for your origin or the
`Range` header, or the objects are not publicly readable (HTTP 403). The browser console
shows the failing requests. Fix the bucket, then sync again; unreadable files are retried.

**The warning "some roots could not be read" appears.** Foundry could not list that root.
Check the source, bucket and folder in **Configure Roots**, and Foundry's S3 configuration.

**Covers are missing.** Make sure the folder has an image file, or that it is an album
folder whose tracks have embedded art. Run **Sync new files**, then **Relink playlists** to
update playlists that were created before the art existed.

**A playlist shows an old cover.** Run **Relink playlists**, or right-click the playlist and
choose **Use library art**.

**A drop did nothing.** Drop onto a playlist row, not empty space, and check you own the
playlist. Tracks already in it are skipped.
