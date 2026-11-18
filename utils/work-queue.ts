export class WorkQueue {
  private _queue: {
    func: () => Promise<any>;
    res: (value: any) => void;
    rej: (e: any) => void;
  }[] = [];

  /**
   * Push a new work item into the queue
   */
  async push<T = void>(func: () => Promise<T>): Promise<T> {
    return new Promise<T>((res, rej) => {
      this._queue.push({ func, res, rej });
    });
  }

  /**
   * Run the oldest command in the queue
   *
   * Commands run in the order they were pushed, so that e.g. a settings change
   * followed by an object change is applied in that order.
   *
   * @returns Promise that settles when the command finished, or `null` if the
   *    queue was empty.
   */
  pop(): Promise<void> | null {
    const item = this._queue.shift();
    if (!item) return null;
    const { func, res, rej } = item;
    let result: Promise<any>;
    try {
      result = Promise.resolve(func());
    } catch (e) {
      result = Promise.reject(e);
    }
    return result.then(res, rej);
  }

  /**
   * Whether the work queue is empty
   */
  get empty() {
    return this._queue.length == 0;
  }
}
