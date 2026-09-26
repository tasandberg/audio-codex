import { describe, expect, it } from "vitest";
import { channelIcon, channelLabel, effectiveChannel } from "./sound-channel";

describe("effectiveChannel", () => {
  it("uses the sound's own channel when it has one", () => {
    expect(effectiveChannel({ channel: "environment" }, { channel: "music" })).toBe("environment");
    expect(effectiveChannel({ channel: "interface" }, { channel: "environment" })).toBe("interface");
  });

  it("inherits the playlist's channel when the sound's is blank", () => {
    expect(effectiveChannel({ channel: "" }, { channel: "environment" })).toBe("environment");
    expect(effectiveChannel({}, { channel: "interface" })).toBe("interface");
    expect(effectiveChannel({ channel: null }, { channel: "music" })).toBe("music");
  });

  it("falls back to music when neither names a known channel", () => {
    expect(effectiveChannel({ channel: "" }, { channel: "" })).toBe("music");
    expect(effectiveChannel({ channel: "radio" }, undefined)).toBe("music");
    expect(effectiveChannel(null, null)).toBe("music");
  });

  it("ignores an unknown sound channel in favour of the playlist's", () => {
    expect(effectiveChannel({ channel: "toString" }, { channel: "environment" })).toBe("environment");
  });
});

describe("channel presentation", () => {
  it("maps each channel to a distinct Font Awesome icon", () => {
    expect(channelIcon("music")).toBe("fa-music");
    expect(channelIcon("environment")).toBe("fa-tree");
    expect(channelIcon("interface")).toBe("fa-bell");
  });

  it("maps each channel to a localization key", () => {
    expect(channelLabel("music")).toBe("AUDIO_CODEX.Channel.Music");
    expect(channelLabel("environment")).toBe("AUDIO_CODEX.Channel.Environment");
    expect(channelLabel("interface")).toBe("AUDIO_CODEX.Channel.Interface");
  });
});
