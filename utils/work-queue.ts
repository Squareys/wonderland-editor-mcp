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
   * Run the top most command in the queue
   *
   * @returns `true`, if a command was run, `false` if the queue was empty.
   */
  pop(): boolean {
    if (this._queue.length == 0) return false;
    const { func, res, rej } = this._queue.pop()!;
    func().then(res).catch(rej);

    return true;
  }

  /**
   * Whether the work queue is empty
   */
  get empty() {
      return this._queue.length == 0;
  }
}
