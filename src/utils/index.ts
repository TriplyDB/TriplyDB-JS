import debug from "debug";
import type { UploadOptions } from "@triply/tus-js-client";

export function wait(ms: number) {
  return new Promise<void>(function (resolve) {
    setTimeout(function () {
      resolve();
    }, ms);
  });
}

/**
 * Attempt to set a sticky session cookie in the given headers object. If this
 * somehow fails, the headers aren't changed and this function exits silently.
 */
export async function setStickySessionCookie(headers: { [name: string]: string }, apiUrl: string): Promise<void> {
  try {
    // We know that we respond with a `triply-session-affinity` cookie to
    // requests to endpoints that match `/.*/add/[a-f0-9]{32}`. Therefore we'll
    // just to send a request to a random path that doesn't exist, but does
    // match that regular expression to get a sticky session cookie 🥳
    const response = await fetch(apiUrl + "/bla/add/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
    debug("triply:triplydb-js:sticky-session:cookie")(cookie);
    if (cookie?.includes("triply-session-affinity")) headers.Cookie = cookie;
  } catch (e) {
    debug("triply:triplydb-js:sticky-session:error")(JSON.stringify(e, null, 2));
  }
}

export function formatUploadProgress(
  msSinceLastChunk: number,
  ...[chunkSize, bytesUploaded, bytesTotal]: Parameters<
    Extract<UploadOptions["onChunkComplete"], (...args: any) => any>
  >
) {
  const formattedBytesTotal = bytesTotal.toLocaleString("en");
  const percentage = `${Math.floor((bytesUploaded / bytesTotal) * 99)}`.padStart(2);
  // the time difference is in ms, so the averageSpeed is in bytes / ms = kB / s
  const uploadSpeed = chunkSize / msSinceLastChunk;
  const formattedUploadSpeed =
    uploadSpeed > 1000 ? (uploadSpeed / 1000).toFixed(1) + "M" : uploadSpeed.toFixed(1) + "k";
  return `uploaded ${bytesUploaded
    .toLocaleString("en")
    .padStart(
      formattedBytesTotal.length
    )} of ${formattedBytesTotal} bytes (${percentage}%, ~${formattedUploadSpeed}B/s)`;
}
