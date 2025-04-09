export class WorkQueue {
  _queue: {
    func: () => Promise<void>;
    res: () => void;
    rej: (e: any) => void;
  }[] = [];
  async push(func: () => Promise<void>): Promise<void> {
    return new Promise<void>((res, rej) => {
      this._queue.push({ func, res, rej });
    });
  }

  pop(): boolean {
    if (this._queue.length == 0) return false;
    const { func, res, rej } = this._queue.pop()!;
    func().then(res).catch(rej);

    return this._queue.length != 0;
  }
}
