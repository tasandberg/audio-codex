import { describe, expect, it } from "vitest";
import { chooseCover, fileExtension, isAudioFile, isImageFile, stripExtension } from "./constants";

describe("audio file helpers", () => {
  it("matches Foundry's audio extensions case-insensitively", () => {
    expect(isAudioFile("Track.MP3")).toBe(true);
    expect(isAudioFile("song.opus")).toBe(true);
    expect(isAudioFile("cover.jpg")).toBe(false);
    expect(isAudioFile("noscan.txt")).toBe(false);
    expect(isAudioFile("README")).toBe(false);
  });

  it("treats # and ? as ordinary characters in decoded names", () => {
    expect(fileExtension("Song #1.ogg")).toBe("ogg");
    expect(isAudioFile("What?.flac")).toBe(true);
    expect(fileExtension("a.b/c")).toBe("b/c");
  });

  it("strips only the final extension", () => {
    expect(stripExtension("01 - Intro.v2.mp3")).toBe("01 - Intro.v2");
    expect(stripExtension(".hidden")).toBe(".hidden");
    expect(stripExtension("plain")).toBe("plain");
  });
});

describe("cover selection", () => {
  it("matches image extensions case-insensitively", () => {
    expect(isImageFile("Cover.JPG")).toBe(true);
    expect(isImageFile("art.webp")).toBe(true);
    expect(isImageFile("track.mp3")).toBe(false);
  });

  it("prefers cover, then folder, then the alphabetically first image", () => {
    expect(chooseCover(["back.png", "Folder.jpeg", "COVER.webp"])).toBe("COVER.webp");
    expect(chooseCover(["zoo.png", "FOLDER.jpg", "art.gif"])).toBe("FOLDER.jpg");
    expect(chooseCover(["zoo.png", "art.gif", "01.mp3"])).toBe("art.gif");
    expect(chooseCover(["01.mp3", "notes.txt"])).toBeNull();
    expect(chooseCover([])).toBeNull();
  });

  it("ignores files that merely start with cover", () => {
    expect(chooseCover(["coverart.png", "b.jpg"])).toBe("b.jpg");
  });
});
