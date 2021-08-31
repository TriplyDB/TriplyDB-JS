function busyWait<T>(promise: Promise<T>): T {
  let result: T | undefined;
  let finished = false;
  let error: any;
  let errored = false;
  promise
    .then((value) => {
      result = value;
      finished = true;
    })
    .catch((reason) => {
      error = reason;
      errored = true;
    });
  while (true) {
    if (finished) return result!;
    if (errored) throw error;
  }
}

export function makeSync<T>(asyncIterator: AsyncIterator<T>): Iterator<T> {
  return {
    next: () => busyWait(asyncIterator.next()),
  };
}
