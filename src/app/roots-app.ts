import type { DeepPartial } from "fvtt-types/utils";
import { MODULE_ID } from "../constants";
import { localize } from "../foundry/i18n";
import { type RootInput, normalizeRoot, rootLocation, validateRoot } from "../roots/roots";
import { getRoots, setRoots, userCanUseCodex } from "../settings";
import { FileLocation } from "../storage/file-location";
import type { Root } from "../types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

declare const ForgeVTT: { usingTheForge?: boolean } | undefined;

interface Option {
  value: string;
  label: string;
  selected: boolean;
}

interface RootView extends Root {
  sources: Option[];
  buckets: Option[];
}

interface RootsContext extends foundry.applications.api.ApplicationV2.RenderContext {
  roots: RootView[];
  buttons: Array<{ type: string; icon: string; label: string }>;
}

interface FileConfig {
  storages?: string[];
  s3?: { buckets?: string[] | null } | null;
}

function fileConfig(): FileConfig {
  return (game.data as unknown as { files?: FileConfig }).files ?? {};
}

function availableSources(): string[] {
  const sources = [...(fileConfig().storages ?? ["data"])];
  if (typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge) sources.push("forgevtt");
  return sources;
}

export class RootsApp extends HandlebarsApplicationMixin(ApplicationV2)<RootsContext> {
  static override DEFAULT_OPTIONS = {
    id: "audio-codex-roots",
    tag: "form",
    window: { title: "AUDIO_CODEX.Roots.Title", icon: "fa-solid fa-folder-tree", contentClasses: ["standard-form"] },
    position: { width: 640 },
    form: { handler: RootsApp.#onSubmit, closeOnSubmit: true },
    actions: { addRoot: RootsApp.#onAddRoot, removeRoot: RootsApp.#onRemoveRoot, browseRoot: RootsApp.#onBrowseRoot },
  };

  static override PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/roots.hbs`, scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  static #instance: RootsApp | null = null;

  static open(): RootsApp | null {
    if (!userCanUseCodex()) {
      ui.notifications?.warn(localize("AUDIO_CODEX.Permission.Denied"));
      return null;
    }
    RootsApp.#instance ??= new RootsApp();
    void RootsApp.#instance.render({ force: true });
    return RootsApp.#instance;
  }

  static closeIfOpen(): void {
    void RootsApp.#instance?.close();
  }

  #draft: Root[] = getRoots();

  protected override async _prepareContext(options: foundry.applications.api.ApplicationV2.RenderOptions): Promise<RootsContext> {
    const context = await super._prepareContext(options);
    const buckets = fileConfig().s3?.buckets ?? [];
    return {
      ...context,
      roots: this.#draft.map((root) => ({
        ...root,
        sources: availableSources().map((source) => ({ value: source, label: source, selected: source === root.source })),
        buckets: buckets.map((bucket) => ({ value: bucket, label: bucket, selected: bucket === root.bucket })),
      })),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "AUDIO_CODEX.Roots.Save" }],
    };
  }

  #readForm(): Root[] {
    if (!(this.element instanceof HTMLFormElement)) return this.#draft;
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object) as { roots?: Record<string, RootInput> };
    return Object.values(data.roots ?? {}).map((input) => normalizeRoot(input, () => foundry.utils.randomID()));
  }

  static async #onSubmit(this: RootsApp): Promise<void> {
    const roots = this.#readForm();
    const invalid = roots.map(validateRoot).find(Boolean);
    if (invalid) throw new Error(localize(invalid));
    await setRoots(roots);
  }

  static #onAddRoot(this: RootsApp): void {
    this.#draft = [...this.#readForm(), normalizeRoot({ source: availableSources()[0] ?? "data" }, () => foundry.utils.randomID())];
    void this.render();
  }

  static #onRemoveRoot(this: RootsApp, _event: PointerEvent, target: HTMLElement): void {
    const index = Number(target.dataset.index);
    this.#draft = this.#readForm().filter((_root, position) => position !== index);
    void this.render();
  }

  static #onBrowseRoot(this: RootsApp, _event: PointerEvent, target: HTMLElement): void {
    this.#draft = this.#readForm();
    const index = Number(target.dataset.index);
    const root = this.#draft[index];
    if (!root) return;
    const Picker = foundry.applications.apps.FilePicker.implementation;
    const picker = new Picker({
      type: "folder",
      current: rootLocation(root).toString(),
      callback: (path: string, chosen: foundry.applications.apps.FilePicker) => {
        const source = chosen.activeSource;
        const bucket = source === "s3" ? ((chosen.source as { bucket?: string }).bucket ?? null) : null;
        this.#draft[index] = normalizeRoot({ ...root, label: root.prefix ? root.label : undefined, source, bucket, prefix: FileLocation.parse(path).key }, () => root.id);
        void this.render();
      },
    });
    void picker.render({ force: true });
  }
}

type RenderInput = DeepPartial<foundry.applications.api.ApplicationV2.RenderOptions>;

export class RootsMenu extends RootsApp {
  override render(_options?: boolean | RenderInput, _legacyOptions?: RenderInput): Promise<this> {
    RootsApp.open();
    return Promise.resolve(this);
  }
}
