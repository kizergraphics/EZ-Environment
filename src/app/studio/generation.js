import { ObjectLoader } from 'three';
import { disposeObject } from '../environment/assets.js';
export class GenerationClient {
  constructor() { this.id = 0; this.worker = null; this.pending = null; }

  generate(mode, definition, quality = 'export') {
    this.cancel();
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending = resolve;
      let worker = null;
      const current = () => this.worker === worker && this.pending === resolve;
      const finish = () => {
        // Clear ownership before termination: even a queued old event cannot
        // clear a newer job, or leave its promise without a cancellation path.
        this.worker = null; this.pending = null;
        if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
      };
      try {
        worker = new Worker(new URL('./generator.worker.js', import.meta.url), { type: 'module' });
        this.worker = worker;
        worker.onmessage = ({ data }) => {
          if (!current() || data?.id !== id) return;
          const lods = [];
          try {
            if (data.error) throw new Error(data.error);
            if (!Array.isArray(data.lods) || data.lods.length !== 3) throw new Error('Asset generation returned invalid LODs.');
            const loader = new ObjectLoader();
            for (const json of data.lods) lods.push(loader.parse(json));
            let disposed = false;
            const asset = { ...data, lods, object3D: lods[0], dispose() {
              if (disposed) return;
              disposed = true; lods.forEach(l => disposeObject(l, true));
            } };
            finish(); resolve(asset);
          } catch (error) {
            lods.forEach(l => disposeObject(l, true));
            finish(); reject(error);
          }
        };
        worker.onerror = e => {
          if (!current()) return;
          finish(); reject(new Error(e.message || 'Asset generation failed.'));
        };
        worker.postMessage({ id, mode, definition, quality });
      } catch (error) {
        // Construction and structured-clone/postMessage can both throw before
        // a worker event exists to settle the current request.
        if (current()) { finish(); reject(error); }
      }
    });
  }

  cancel() {
    const worker = this.worker, pending = this.pending;
    this.worker = null; this.pending = null;
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
    pending?.(null);
  }

  dispose() { this.cancel(); }
}
