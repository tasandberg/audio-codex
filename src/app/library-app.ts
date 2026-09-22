import { MODULE_ID } from "../constants";
import { playlistSources, uploadDeps } from "../foundry/adapters";
import { localize } from "../foundry/i18n";
import { DEFAULT_SORT, type Library, SEARCH_LIMIT, type SortColumn, type SortState, folderId } from "../library/library";
import { coverFlag } from "../playlist/cover-resolve";
import { createPlaylistFromFolder, dropOnPlaylist, relinkPlaylists } from "../playlist/playlist-actions";
import { DRAG_TYPE, type DragPayload, type Point, dropPoint, dropTargetAt } from "../playlist/playlist-drop";
import { canManage, cleanName, deletePlaylist, removeSound, renamePlaylist, setPlaylistCover } from "../playlist/playlist-manage";
import { service } from "../service";
import { userCanUseCodex } from "../settings";
import { FileLocation } from "../storage/file-location";
import { SyncCancelled, SyncControl } from "../sync/control";
import type { EditableField } from "../types";
import { type EntryLike, collectFiles, hasAudioFile, planUpload, runUpload } from "../upload/uploader";
import { RootsApp } from "./roots-app";
import { type ColumnView, type PlaylistView, type ProgressView, type RowView, type UploadProgress, columnViews, playlistViews, progressView, rowView, summaryLabel, trackView } from "./view";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

interface LibraryContext extends foundry.applications.api.ApplicationV2.RenderContext {
  isGM: boolean;
  query: string;
  busy: boolean;
  paused: boolean;
  progress: ProgressView | null;
  stale: boolean;
  summary: string;
  columns: ColumnView[];
  rows: RowView[];
  playlists: PlaylistView[];
  canCreatePlaylist: boolean;
}

type MenuEntry = foundry.applications.ux.ContextMenu.Entry<HTMLElement>;

const PLAYLIST_HOOKS = ["createPlaylist", "updatePlaylist", "deletePlaylist", "createPlaylistSound", "updatePlaylistSound", "deletePlaylistSound"] as const;

type PlaylistHook = (typeof PLAYLIST_HOOKS)[number];

const localizeCounts = (key: string, data: Record<string, number>) => localize(key, data);

export class LibraryApp extends HandlebarsApplicationMixin(ApplicationV2)<LibraryContext> {
  static override DEFAULT_OPTIONS = {
    id: "audio-codex-library",
    classes: ["audio-codex"],
    window: { title: "AUDIO_CODEX.Title", icon: "fa-solid fa-book-open", resizable: true },
    position: { width: 1120, height: 640 },
    actions: {
      refresh: LibraryApp.#onRefresh,
      relink: LibraryApp.#onRelink,
      rescan: LibraryApp.#onRescan,
      pause: LibraryApp.#onPause,
      resume: LibraryApp.#onResume,
      cancel: LibraryApp.#onCancel,
      openRoots: LibraryApp.#onOpenRoots,
      toggleFolder: LibraryApp.#onToggleFolder,
      sortBy: LibraryApp.#onSortBy,
      togglePlaylist: LibraryApp.#onTogglePlaylist,
      createPlaylist: LibraryApp.#onCreatePlaylist,
    },
  };

  static override PARTS = {
    search: { template: `modules/${MODULE_ID}/templates/library-search.hbs` },
    toolbar: { template: `modules/${MODULE_ID}/templates/library-toolbar.hbs` },
    playlists: { template: `modules/${MODULE_ID}/templates/library-playlists.hbs`, scrollable: [".ac-playlist-list"] },
    tree: { template: `modules/${MODULE_ID}/templates/library-tree.hbs`, scrollable: [".ac-rows"] },
  };

  static #instance: LibraryApp | null = null;

  static open(): LibraryApp | null {
    if (!userCanUseCodex()) {
      ui.notifications?.warn(localize("AUDIO_CODEX.Permission.Denied"));
      return null;
    }
    LibraryApp.#instance ??= new LibraryApp();
    void LibraryApp.#instance.render({ force: true });
    return LibraryApp.#instance;
  }

  static closeIfOpen(): void {
    void LibraryApp.#instance?.close();
  }

  #expanded = new Set<string>();
  #expandedPlaylists = new Set<string>();
  #hooks: Array<[PlaylistHook, number]> = [];
  #sort: SortState = DEFAULT_SORT;
  #query = "";
  #searchTimer: ReturnType<typeof setTimeout> | null = null;
  #unsubscribe: (() => void) | null = null;
  #library: Library = service.library;
  #dragPayload: DragPayload | null = null;
  #lastDragOver: Point | null = null;
  #uploadControl: SyncControl | null = null;
  #uploadProgress: UploadProgress | null = null;
  #playlistRenderTimer: ReturnType<typeof setTimeout> | null = null;
  #relinking = false;
  #highlighted: string | null = null;
  #rows: RowView[] | null = null;
  #matches: number | null = null;
  #playlists: PlaylistView[] | null = null;

  #queuePlaylistRender(): void {
    if (this.#playlistRenderTimer) return;
    this.#playlistRenderTimer = setTimeout(() => {
      this.#playlistRenderTimer = null;
      if (this.rendered) void this.render({ parts: ["playlists"] });
    }, 50);
  }

  get #control(): SyncControl | null {
    return this.#uploadControl ?? service.control;
  }

  protected override async _prepareContext(options: foundry.applications.api.ApplicationV2.RenderOptions): Promise<LibraryContext> {
    const context = await super._prepareContext(options);
    const library = service.library;
    let rows = this.#rows;
    if (!rows || !options.parts || options.parts.includes("tree")) {
      const searching = Boolean(this.#query.trim());
      rows = searching
        ? library.search(this.#query).map((track) => trackView(track, 0, true))
        : library.rows(this.#expanded, this.#sort).map(rowView);
      this.#matches = searching ? rows.length : null;
      this.#rows = rows;
      this.#library = library;
    }
    let playlists = this.#playlists;
    if (!playlists || !options.parts || options.parts.includes("playlists")) {
      playlists = playlistViews(playlistSources(this.#expandedPlaylists, library), this.#expandedPlaylists);
      this.#playlists = playlists;
    }
    return {
      ...context,
      isGM: game.user.isGM,
      query: this.#query,
      busy: Boolean(this.#control),
      paused: this.#control?.paused ?? false,
      progress: progressView(service.progress, this.#uploadProgress, localizeCounts),
      stale: game.user.isGM && service.stale,
      summary: summaryLabel(library.size, this.#matches, SEARCH_LIMIT, localizeCounts),
      columns: columnViews(this.#sort),
      rows,
      playlists,
      canCreatePlaylist: foundry.documents.Playlist.implementation.canUserCreate(game.user),
    };
  }

  protected override async _onFirstRender(context: LibraryContext, options: foundry.applications.api.ApplicationV2.RenderOptions): Promise<void> {
    await super._onFirstRender(context, options);
    this.#unsubscribe = service.subscribe(() => {
      const parts = service.library === this.#library ? ["toolbar"] : ["toolbar", "tree"];
      void this.render({ parts });
    });
    for (const hook of PLAYLIST_HOOKS) {
      const handler = (doc: { id?: string | null }) => {
        if (hook === "deletePlaylist") this.#expandedPlaylists.delete(doc?.id ?? "");
        this.#queuePlaylistRender();
      };
      this.#hooks.push([hook, Hooks.on(hook, handler)]);
    }
    new foundry.applications.ux.ContextMenu(this.element, ".ac-folder", this.#folderMenu(), { jQuery: false, fixed: true });
    new foundry.applications.ux.ContextMenu(this.element, ".ac-track", this.#trackMenu(), { jQuery: false, fixed: true });
    new foundry.applications.ux.ContextMenu(this.element, ".ac-playlist-head", this.#playlistMenu(), { jQuery: false, fixed: true });
    new foundry.applications.ux.ContextMenu(this.element, ".ac-sound", this.#soundMenu(), { jQuery: false, fixed: true });
    this.element.addEventListener("input", (event) => this.#onSearchInput(event));
    this.element.addEventListener("dblclick", (event) => this.#onDoubleClick(event));
    this.element.addEventListener("dragstart", (event) => this.#onDragStart(event));
    this.element.addEventListener("dragend", (event) => void this.#onDragEnd(event));
    this.element.addEventListener("dragover", (event) => this.#onDragOver(event));
    this.element.addEventListener("drop", (event) => void this.#onDrop(event));
    void service.ensureLoaded().then(() => service.autoSync());
  }

  protected override _onClose(options: foundry.applications.api.ApplicationV2.RenderOptions): void {
    super._onClose(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    this.#searchTimer = null;
    if (this.#playlistRenderTimer) clearTimeout(this.#playlistRenderTimer);
    this.#playlistRenderTimer = null;
    document.removeEventListener("dragover", this.#trackPointer);
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
    this.#dragPayload = null;
    this.#lastDragOver = null;
  }

  #onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.name !== "query") return;
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(() => {
      this.#query = input.value;
      void this.render({ parts: ["toolbar", "tree"] });
    }, 250);
  }

  #folderMenu(): MenuEntry[] {
    return [
      { label: "AUDIO_CODEX.Menu.SetArtist", icon: "fa-solid fa-user", visible: () => game.user.isGM, onClick: (_event, target) => void this.#bulkSet(target, "artist") },
      { label: "AUDIO_CODEX.Menu.SetAlbum", icon: "fa-solid fa-compact-disc", visible: () => game.user.isGM, onClick: (_event, target) => void this.#bulkSet(target, "album") },
      {
        label: "AUDIO_CODEX.Menu.CreatePlaylist",
        icon: "fa-solid fa-list-music",
        visible: () => foundry.documents.Playlist.implementation.canUserCreate(game.user),
        onClick: (_event, target) => {
          const folder = service.library.folder(target.dataset.folderId ?? "");
          if (folder) void createPlaylistFromFolder(folder);
        },
      },
    ];
  }

  #trackMenu(): MenuEntry[] {
    return [
      {
        label: "AUDIO_CODEX.Menu.Revert",
        icon: "fa-solid fa-rotate-left",
        visible: (target) => game.user.isGM && target.classList.contains("ac-overridden"),
        onClick: (_event, target) => void service.revert(target.dataset.rootId ?? "", target.dataset.key ?? ""),
      },
    ];
  }

  #playlistAt(target: HTMLElement): Playlist.Implementation | undefined {
    return game.playlists.get(target.closest<HTMLElement>(".ac-playlist")?.dataset.playlistId ?? "");
  }

  #soundAt(target: HTMLElement): PlaylistSound.Implementation | undefined {
    return this.#playlistAt(target)?.sounds.get(target.closest<HTMLElement>(".ac-sound")?.dataset.soundId ?? "");
  }

  async #manage(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error(`${MODULE_ID} | playlist action failed`, error);
      ui.notifications?.error(localize("AUDIO_CODEX.Playlist.Failed"));
    }
  }

  #playlistMenu(): MenuEntry[] {
    const owned = (target: HTMLElement) => canManage(this.#playlistAt(target));
    return [
      { label: "AUDIO_CODEX.Playlist.Rename", icon: "fa-solid fa-pen", visible: owned, onClick: (_event, target) => void this.#renamePlaylist(target) },
      { label: "AUDIO_CODEX.Playlist.SetCover", icon: "fa-solid fa-image", visible: owned, onClick: (_event, target) => this.#pickCover(target) },
      {
        label: "AUDIO_CODEX.Playlist.ClearCover",
        icon: "fa-solid fa-image-slash",
        visible: (target) => {
          const playlist = this.#playlistAt(target);
          return canManage(playlist) && Boolean(coverFlag(playlist));
        },
        onClick: (_event, target) => void this.#withPlaylist(target, (playlist) => setPlaylistCover(playlist, null)),
      },
      { label: "AUDIO_CODEX.Playlist.Delete", icon: "fa-solid fa-trash", visible: owned, onClick: (_event, target) => void this.#withPlaylist(target, deletePlaylist) },
    ];
  }

  #soundMenu(): MenuEntry[] {
    return [
      {
        label: "AUDIO_CODEX.Playlist.RemoveSound",
        icon: "fa-solid fa-trash",
        visible: (target) => canManage(this.#playlistAt(target)),
        onClick: (_event, target) => {
          const sound = this.#soundAt(target);
          if (sound) void this.#manage(() => removeSound(sound));
        },
      },
    ];
  }

  async #withPlaylist(target: HTMLElement, run: (playlist: Playlist.Implementation) => Promise<unknown>): Promise<void> {
    const playlist = this.#playlistAt(target);
    if (playlist) await this.#manage(() => run(playlist));
  }

  async #promptName(title: string, current = ""): Promise<string | null> {
    const result = (await foundry.applications.api.DialogV2.input({
      window: { title: localize(title) },
      content: `<input type="text" name="name" value="${foundry.utils.escapeHTML(current)}" autofocus>`,
      render: (_event: Event, dialog: foundry.applications.api.DialogV2) => dialog.element.querySelector<HTMLInputElement>('input[name="name"]')?.select(),
    })) as { name?: string } | null;
    return result ? cleanName(result.name, current) : null;
  }

  async #renamePlaylist(target: HTMLElement): Promise<void> {
    const playlist = this.#playlistAt(target);
    if (!playlist) return;
    const name = await this.#promptName("AUDIO_CODEX.Playlist.Rename", playlist.name);
    if (name) await this.#manage(() => renamePlaylist(playlist, name));
  }

  #pickCover(target: HTMLElement): void {
    const playlist = this.#playlistAt(target);
    if (!playlist) return;
    const flag = coverFlag(playlist) ?? "";
    void new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: flag.includes("://") ? "" : flag,
      callback: (path: string) => void this.#manage(() => setPlaylistCover(playlist, path)),
    }).render({ force: true });
  }

  async #bulkSet(target: HTMLElement, field: "artist" | "album"): Promise<void> {
    const folder = service.library.folder(target.dataset.folderId ?? "");
    if (!folder) return;
    const title = localize(field === "artist" ? "AUDIO_CODEX.Menu.SetArtist" : "AUDIO_CODEX.Menu.SetAlbum");
    const result = (await foundry.applications.api.DialogV2.input({
      window: { title },
      content: `<input type="text" name="value" autofocus>`,
    })) as { value?: string } | null;
    if (!result) return;
    const tracks = service.library.tracksBeneath(folder);
    await service.edit(tracks.map((track) => ({ rootId: track.rootId, key: track.key, fields: { [field]: result.value ?? "" } })));
  }

  #onDragStart(event: DragEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>(".ac-folder, .ac-track");
    if (!row || !event.dataTransfer) return;
    const rootId = row.dataset.rootId ?? "";
    const key = row.dataset.key ?? "";
    const payload: DragPayload = row.classList.contains("ac-folder")
      ? { type: DRAG_TYPE, folders: [{ rootId, dir: key }] }
      : { type: DRAG_TYPE, rows: [{ rootId, key }] };
    this.#dragPayload = payload;
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
    document.addEventListener("dragover", this.#trackPointer);
    setTimeout(() => {
      if (this.rendered && this.#dragPayload === payload) this.element.classList.add("ac-dragging");
    }, 0);
  }

  readonly #trackPointer = (event: DragEvent): void => {
    this.#lastDragOver = { x: event.clientX, y: event.clientY };
    if (this.rendered) this.#highlight(dropTargetAt(this.#lastDragOver, document, this.element.getBoundingClientRect()));
  };

  #highlight(playlistId: string | null): void {
    if (playlistId === this.#highlighted) return;
    this.#highlighted = playlistId;
    if (!this.rendered) return;
    for (const row of this.element.querySelectorAll(".ac-playlist.ac-drop-hover")) row.classList.remove("ac-drop-hover");
    if (playlistId) this.element.querySelector(`.ac-playlist[data-playlist-id="${playlistId}"]`)?.classList.add("ac-drop-hover");
  }

  async #onDragEnd(event: DragEvent): Promise<void> {
    document.removeEventListener("dragover", this.#trackPointer);
    this.element.classList.remove("ac-dragging");
    this.#highlight(null);
    const payload = this.#dragPayload;
    const point = dropPoint(event, this.#lastDragOver);
    const windowRect = this.element.getBoundingClientRect();
    this.#dragPayload = null;
    this.#lastDragOver = null;
    if (!payload || !point) return;
    const playlistId = dropTargetAt(point, document, windowRect);
    if (playlistId) await dropOnPlaylist(playlistId, payload);
  }

  #acceptsFiles(event: DragEvent): boolean {
    return !this.#dragPayload && game.user.isGM && Boolean(event.dataTransfer?.types.includes("Files"));
  }

  #onDragOver(event: DragEvent): void {
    if (!this.#acceptsFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  async #onDrop(event: DragEvent): Promise<void> {
    if (!this.#acceptsFiles(event) || !event.dataTransfer) return;
    event.preventDefault();
    const entries = [...event.dataTransfer.items]
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry !== null) as EntryLike[];
    const row = (event.target as HTMLElement).closest<HTMLElement>(".ac-folder, .ac-track");
    const track = row?.classList.contains("ac-track") ? service.library.track(row.dataset.rootId ?? "", row.dataset.key ?? "") : undefined;
    const folder = service.library.folder(track ? folderId(track.rootId, track.dirKey) : row?.dataset.folderId ?? "");
    const root = folder && service.library.root(folder.rootId);
    if (!folder || !root) return void ui.notifications?.warn(localize("AUDIO_CODEX.Upload.NoTarget"));
    if (!["data", "s3"].includes(root.source)) return void ui.notifications?.warn(localize("AUDIO_CODEX.Upload.Unsupported"));
    if (service.control) return void ui.notifications?.warn(localize("AUDIO_CODEX.Upload.Busy"));
    const control = new SyncControl();
    this.#uploadControl = control;
    service.control = control;
    try {
      const files = await collectFiles(entries);
      if (!hasAudioFile(files)) {
        ui.notifications?.warn(localize("AUDIO_CODEX.Upload.NoAudio"));
        return;
      }
      const plan = planUpload(files, new FileLocation(root.source, folder.key, root.bucket));
      this.#uploadProgress = { done: 0, total: plan.uploads.length };
      if (this.rendered) void this.render({ parts: ["toolbar"] });
      const result = await runUpload(plan, uploadDeps, control, (done, total) => {
        if (control.cancelled) return;
        this.#uploadProgress = { done, total };
        if (this.rendered) void this.render({ parts: ["toolbar"] });
      });
      this.#uploadProgress = null;
      await service.splice(root, result.uploaded, control);
      ui.notifications?.info(localize("AUDIO_CODEX.Upload.Done", { uploaded: result.uploaded.length, failed: result.failed.length }));
    } catch (error) {
      if (error instanceof SyncCancelled) ui.notifications?.warn(localize("AUDIO_CODEX.Upload.Cancelled"));
      else {
        console.error(`${MODULE_ID} | upload failed`, error);
        ui.notifications?.error(localize("AUDIO_CODEX.Upload.Failed"));
      }
    } finally {
      this.#uploadControl = null;
      service.control = null;
      this.#uploadProgress = null;
      if (this.rendered) void this.render({ parts: ["toolbar", "tree"] });
    }
  }

  static #onRefresh(this: LibraryApp): void {
    void service.sync(false);
  }

  static #onRelink(this: LibraryApp): void {
    void this.#relink();
  }

  async #relink(): Promise<void> {
    if (this.#relinking || !game.user.isGM || service.control) return;
    this.#relinking = true;
    try {
      await service.ensureLoaded();
      const { sounds, playlists, unmatched } = await relinkPlaylists(game.playlists.contents, service.library);
      ui.notifications?.info(localize("AUDIO_CODEX.Relink.Done", { sounds, playlists, unmatched }));
    } catch (error) {
      console.error(`${MODULE_ID} | relink failed`, error);
      ui.notifications?.error(localize("AUDIO_CODEX.Relink.Failed"));
    } finally {
      this.#relinking = false;
    }
  }

  static #onRescan(this: LibraryApp): void {
    void service.sync(true);
  }

  static #onPause(this: LibraryApp): void {
    this.#control?.pause();
    void this.render({ parts: ["toolbar"] });
  }

  static #onResume(this: LibraryApp): void {
    this.#control?.resume();
    void this.render({ parts: ["toolbar"] });
  }

  static #onCancel(this: LibraryApp): void {
    this.#control?.cancel();
  }

  static #onOpenRoots(this: LibraryApp): void {
    RootsApp.open();
  }

  static #onToggleFolder(this: LibraryApp, _event: PointerEvent, target: HTMLElement): void {
    const id = target.closest<HTMLElement>(".ac-folder")?.dataset.folderId;
    if (!id) return;
    if (this.#expanded.has(id)) this.#expanded.delete(id);
    else this.#expanded.add(id);
    void this.render({ parts: ["tree"] });
  }

  static #onTogglePlaylist(this: LibraryApp, event: PointerEvent, target: HTMLElement): void {
    const id = this.#playlistAt(target)?.id;
    if (!id || event.detail > 1) return;
    if (this.#expandedPlaylists.has(id)) this.#expandedPlaylists.delete(id);
    else this.#expandedPlaylists.add(id);
    void this.render({ parts: ["playlists"] });
  }

  static #onCreatePlaylist(this: LibraryApp): void {
    void this.#createPlaylist();
  }

  async #createPlaylist(): Promise<void> {
    const name = await this.#promptName("AUDIO_CODEX.Playlist.Create");
    if (!name) return;
    await this.#manage(() => foundry.documents.Playlist.implementation.create({ name, sorting: foundry.CONST.PLAYLIST_SORT_MODES.MANUAL }));
  }

  static #onSortBy(this: LibraryApp, _event: PointerEvent, target: HTMLElement): void {
    const column = target.dataset.column as SortColumn;
    const direction = this.#sort.column === column && this.#sort.direction === 1 ? -1 : 1;
    this.#sort = { column, direction };
    void this.render({ parts: ["tree"] });
  }

  #onDoubleClick(event: MouseEvent): void {
    const element = event.target as HTMLElement;
    const cell = element.closest<HTMLElement>(".ac-track [data-field]");
    if (cell) {
      this.#editCell(cell);
      return;
    }
    const head = element.closest<HTMLElement>(".ac-playlist-head");
    if (head && canManage(this.#playlistAt(head))) void this.#renamePlaylist(head);
  }

  #editCell(target: HTMLElement): void {
    if (!game.user.isGM || target.querySelector("input")) return;
    const row = target.closest<HTMLElement>(".ac-track");
    const track = row ? service.library.track(row.dataset.rootId ?? "", row.dataset.key ?? "") : undefined;
    const field = target.dataset.field as EditableField | undefined;
    if (!row || !track || !field) return;
    const original = String((field === "title" ? track.label : track[field]) ?? "");
    const input = document.createElement("input");
    input.type = field === "track" ? "number" : "text";
    input.value = original;
    row.draggable = false;
    target.replaceChildren(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (commit && input.value !== original) await service.edit([{ rootId: track.rootId, key: track.key, fields: { [field]: input.value } }]);
      else void this.render({ parts: ["tree"] });
    };
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void finish(event.key === "Enter");
    });
    input.addEventListener("blur", () => void finish(true));
  }
}
