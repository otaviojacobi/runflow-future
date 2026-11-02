import { describe, expect, it } from "vitest";
import { embedUrl, parseVideo, thumbnailUrl } from "./video";

describe("video links", () => {
  it("parses YouTube and Vimeo", () => {
    expect(parseVideo("https://www.youtube.com/watch?v=abc123XYZ_-")).toEqual({ provider: "youtube", id: "abc123XYZ_-" });
    expect(parseVideo("https://youtu.be/abc123XYZ")).toEqual({ provider: "youtube", id: "abc123XYZ" });
    expect(parseVideo("https://youtube.com/shorts/abc123XYZ")).toEqual({ provider: "youtube", id: "abc123XYZ" });
    expect(parseVideo("https://vimeo.com/123456")).toEqual({ provider: "vimeo", id: "123456" });
    expect(parseVideo("https://example.com/v.mp4")).toBeNull();
  });
  it("embeds without tracking cookies", () => {
    expect(embedUrl("https://youtu.be/abc123XYZ")).toBe("https://www.youtube-nocookie.com/embed/abc123XYZ?rel=0");
    expect(embedUrl("https://vimeo.com/42")).toBe("https://player.vimeo.com/video/42?dnt=1");
    expect(thumbnailUrl("https://vimeo.com/42")).toBeNull();
  });
});
