import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, ObjectLoader } from 'three';
import { GenerationClient } from '../src/app/studio/generation.js';

function installWorker(t) {
  const previous = globalThis.Worker;
  class MockWorker {
    static instances = [];
    static constructionError = null;
    static postError = null;
    constructor() {
      if (MockWorker.constructionError) throw MockWorker.constructionError;
      MockWorker.instances.push(this); this.terminated = 0;
    }
    postMessage(data) {
      this.request = data;
      if (MockWorker.postError) throw MockWorker.postError;
    }
    terminate() { this.terminated++; }
    message(data) { this.onmessage?.({ data }); }
  }
  globalThis.Worker = MockWorker;
  t.after(() => { globalThis.Worker = previous; });
  return MockWorker;
}

function response(worker) {
  return { id: worker.request.id, definition: worker.request.definition, definitionHash: 'fixture',
    lods: [0, 1, 2].map(i => { const group = new Group(); group.name = `lod${i}`; return group.toJSON(); }) };
}

test('stale worker events cannot clear or cancel the latest generation promise', async t => {
  const Worker = installWorker(t), client = new GenerationClient();
  const first = client.generate('plant', { seed: 1 }), oldWorker = Worker.instances[0];
  const staleMessage = oldWorker.onmessage, staleError = oldWorker.onerror;
  const second = client.generate('plant', { seed: 2 }), nextWorker = Worker.instances[1];
  assert.equal(await first, null);
  const nextPending = client.pending;
  staleMessage({ data: response(oldWorker) });
  staleError({ message: 'Late error from terminated job' });
  assert.equal(client.worker, nextWorker); assert.equal(client.pending, nextPending);
  assert.equal(nextWorker.terminated, 0);
  client.cancel();
  assert.equal(await second, null);
  assert.equal(client.worker, null); assert.equal(client.pending, null);
});

test('current worker ignores a mismatched response id and accepts the matching job', async t => {
  const Worker = installWorker(t), client = new GenerationClient();
  const promise = client.generate('rock', { seed: 5 }), worker = Worker.instances[0];
  worker.message({ ...response(worker), id: worker.request.id + 1 });
  assert.equal(client.worker, worker); assert.equal(worker.terminated, 0);
  worker.message(response(worker));
  const result = await promise;
  assert.equal(result.lods.length, 3); assert.equal(result.object3D, result.lods[0]);
  assert.equal(result.definition.seed, 5);
  assert.equal(client.worker, null); assert.equal(client.pending, null);
  assert.equal(worker.terminated, 1); result.dispose(); result.dispose();
});

test('malformed LOD rejects, disposes already parsed groups, and permits the next valid job', async t => {
  const Worker = installWorker(t), client = new GenerationClient();
  const group = new Group(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  group.add(new Mesh(geometry, material));
  let geometryDisposals = 0, materialDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  const originalParse = ObjectLoader.prototype.parse;
  ObjectLoader.prototype.parse = function(json) { return json?.fixture ? group : originalParse.call(this, json); };
  t.after(() => { ObjectLoader.prototype.parse = originalParse; });
  const bad = client.generate('plant', { seed: 1 }), worker = Worker.instances[0];
  const rejected = assert.rejects(bad);
  assert.doesNotThrow(() => worker.message({ id: worker.request.id, lods: [{ fixture: true }, null, {}] }));
  await rejected;
  assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1);
  assert.equal(client.worker, null); assert.equal(client.pending, null); assert.equal(worker.terminated, 1);
  const good = client.generate('plant', { seed: 2 }), nextWorker = Worker.instances[1];
  nextWorker.message(response(nextWorker));
  const result = await good; assert.equal(result.definition.seed, 2); result.dispose();
});

test('worker construction and postMessage failures reject without retained pending jobs', async t => {
  const Worker = installWorker(t), client = new GenerationClient();
  Worker.constructionError = new Error('No worker available');
  await assert.rejects(client.generate('plant', {}), /No worker available/);
  assert.equal(client.pending, null); assert.equal(client.worker, null);
  Worker.constructionError = null; Worker.postError = new Error('Cannot clone definition');
  await assert.rejects(client.generate('plant', {}), /Cannot clone definition/);
  assert.equal(client.pending, null); assert.equal(client.worker, null);
  assert.equal(Worker.instances[0].terminated, 1);
  Worker.postError = null;
  const promise = client.generate('plant', {}), worker = Worker.instances[1];
  worker.message(response(worker)); (await promise).dispose();
});

test('worker error and returned generation error clean up and reject', async t => {
  const Worker = installWorker(t), client = new GenerationClient();
  const failed = client.generate('plant', {}), worker = Worker.instances[0];
  const rejected = assert.rejects(failed, /Worker failed/);
  worker.onerror({ message: 'Worker failed' }); await rejected;
  assert.equal(client.pending, null); assert.equal(client.worker, null);
  const next = client.generate('rock', {}), nextWorker = Worker.instances[1];
  const nextRejected = assert.rejects(next, /Invalid definition/);
  nextWorker.message({ id: nextWorker.request.id, error: 'Invalid definition' }); await nextRejected;
  assert.equal(client.pending, null); assert.equal(client.worker, null);
});

test('invalid LOD count rejects and disposal is safe with or without a pending job', async t => {
  const Worker = installWorker(t), client = new GenerationClient();
  const failed = client.generate('plant', {}), worker = Worker.instances[0];
  const rejected = assert.rejects(failed, /invalid LODs/);
  worker.message({ id: worker.request.id, lods: [] }); await rejected;
  const canceled = client.generate('plant', {});
  client.dispose(); client.dispose(); assert.equal(await canceled, null);
  assert.equal(client.pending, null); assert.equal(client.worker, null);
});
