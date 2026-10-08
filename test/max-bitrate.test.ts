// How `maxBitrate` is written into the SDP sent to the device.
//
// Build and run:
//   npx esbuild test/max-bitrate.test.ts --bundle --platform=node --outfile=/tmp/t.cjs && node /tmp/t.cjs
//
// libwebrtc on the device caps a video sender at the `b=AS` of the remote description. A line
// in the wrong section, or a second one, would cap the wrong stream or nothing at all.

import { withMaxBitrate } from "../src/utils/rtc-tools";

let failures = 0;

function check(ok: boolean, what: string) {
  console.log((ok ? "  ok   " : "  FAIL ") + what);
  if (!ok) {
    failures++;
  }
}

/** The lines of one media section, from its m= line up to the next one. */
function section(sdp: string, kind: string): string[] {
  const lines = sdp.split("\r\n");
  const start = lines.findIndex((line) => line.startsWith(`m=${kind}`));
  if (start < 0) {
    return [];
  }
  const end = lines.findIndex((line, i) => i > start && line.startsWith("m="));
  return lines.slice(start, end < 0 ? undefined : end);
}

const offer = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1 2",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=mid:0",
  "a=recvonly",
  "m=video 9 UDP/TLS/RTP/SAVPF 96 97",
  "c=IN IP4 0.0.0.0",
  "a=mid:1",
  "a=recvonly",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=mid:2",
  "",
].join("\r\n");

console.log("[1] the video section gets b=AS and b=TIAS right after its c= line");
{
  const video = section(withMaxBitrate(offer, 2000), "video");
  check(video[1] === "c=IN IP4 0.0.0.0", "c= stays first");
  check(video[2] === "b=AS:2000", "b=AS in kbps");
  check(video[3] === "b=TIAS:2000000", "b=TIAS in bps");
}

console.log("[2] other sections are left alone");
{
  const sdp = withMaxBitrate(offer, 2000);
  check(!section(sdp, "audio").some((line) => line.startsWith("b=")), "audio has no b= line");
  check(!section(sdp, "application").some((line) => line.startsWith("b=")), "application has no b= line");
  check(sdp.endsWith("\r\n"), "the trailing line break survives");
}

console.log("[3] an existing cap is replaced, not doubled");
{
  const once = withMaxBitrate(offer, 2000);
  const twice = withMaxBitrate(once, 500);
  const video = section(twice, "video");
  check(video.filter((line) => line.startsWith("b=AS:")).length === 1, "one b=AS line");
  check(video.includes("b=AS:500") && video.includes("b=TIAS:500000"), "with the new value");
}

console.log("[4] fractions of a kbps are rounded");
{
  const video = section(withMaxBitrate(offer, 499.6), "video");
  check(video.includes("b=AS:500"), "b=AS:500");
  check(video.includes("b=TIAS:499600"), "b=TIAS:499600");
}

console.log("[5] a description without video is unchanged");
{
  const dataOnly = offer.split("\r\n").filter((_, i, all) => {
    const start = all.indexOf("m=video 9 UDP/TLS/RTP/SAVPF 96 97");
    return i < start || i > start + 3;
  }).join("\r\n");
  check(withMaxBitrate(dataOnly, 2000) === dataOnly, "same text");
}

console.log("[6] a video section without c= still gets the lines before its attributes");
{
  const sdp = withMaxBitrate("m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\n", 800);
  check(sdp === "m=video 9 UDP/TLS/RTP/SAVPF 96\r\nb=AS:800\r\nb=TIAS:800000\r\na=mid:1\r\n", "before a=mid");
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
