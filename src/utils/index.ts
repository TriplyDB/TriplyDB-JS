export function wait(ms: number) {
  return new Promise<void>(function (resolve) {
    setTimeout(function () {
      resolve();
    }, ms);
  });
}
