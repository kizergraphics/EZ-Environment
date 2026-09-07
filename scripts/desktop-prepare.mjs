import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const publicRoot = path.resolve('src/app/public');
const decoderSource = path.resolve('node_modules/three/examples/jsm/libs/draco');
const decoderTarget = path.join(publicRoot, 'draco');
const licensesTarget = path.join(publicRoot, 'licenses');
await mkdir(decoderTarget, { recursive: true });
await mkdir(licensesTarget, { recursive: true });
for (const file of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
  await copyFile(path.join(decoderSource, 'gltf', file), path.join(decoderTarget, file));
}
await copyFile(path.join(decoderSource, 'README.md'), path.join(decoderTarget, 'README.md'));
await copyFile('desktop/resources/DRACO-LICENSE.txt', path.join(decoderTarget, 'LICENSE.txt'));
for (const [source, target] of [
  ['LICENSE', 'EZ-TREE-LICENSE.txt'],
  ['node_modules/three/LICENSE', 'THREE-LICENSE.txt'],
  ['node_modules/electron/LICENSE', 'ELECTRON-LICENSE.txt'],
  ['desktop/resources/DRACO-LICENSE.txt', 'DRACO-LICENSE.txt'],
  ['desktop/resources/THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md'],
]) await copyFile(source, path.join(licensesTarget, target));
console.log('Prepared offline Draco decoders and third-party notices from installed dependencies.');
