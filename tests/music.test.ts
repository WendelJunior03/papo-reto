import { expect, test } from "bun:test";
import { isoDuration, videoIdFrom } from "../server/music";

test("reconhece links do YouTube", () => {
  expect(videoIdFrom("https://www.youtube.com/watch?v=mC-zw0zCCtg")).toBe("mC-zw0zCCtg");
  expect(videoIdFrom("https://youtu.be/mC-zw0zCCtg?si=abc")).toBe("mC-zw0zCCtg");
  expect(videoIdFrom("https://music.youtube.com/watch?v=mC-zw0zCCtg&list=x")).toBe("mC-zw0zCCtg");
  expect(videoIdFrom("https://www.youtube.com/shorts/mC-zw0zCCtg")).toBe("mC-zw0zCCtg");
  expect(videoIdFrom("https://www.youtube.com/results?search_query=jireh")).toBeNull();
  expect(videoIdFrom("https://evil.com/watch?v=mC-zw0zCCtg")).toBeNull();
});

test("duração ISO do YouTube em segundos", () => {
  expect(isoDuration("PT4M5S")).toBe(245);
  expect(isoDuration("PT1H2M")).toBe(3720);
  expect(isoDuration("PT59S")).toBe(59);
});
