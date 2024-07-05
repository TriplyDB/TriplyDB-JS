// Copied from https://git.triply.cc/triplyetl/etl/-/blob/main/src/utils/msTohms.ts?ref_type=heads
export default function (ms: number): string | undefined {
  const seconds = ms / 1000;
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor((seconds % 3600) % 60);

  var hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : "";
  var mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : "";
  var sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
  const hms = hDisplay + mDisplay + sDisplay;
  return hms ? hms : undefined;
}
