import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3,Vector3 } from 'three';
import { generatePlant,createPlantDefinition } from '../src/app/generators/plants.js';
import { compactPlant } from '../src/app/environment/species.js';
test('legacy untagged compaction preserves triangles, world bounds and material colors with one draw per LOD',()=>{
  const a=generatePlant(createPlantDefinition('flower'));
  a.lods.forEach(l=>l.traverse(o=>{if(o.material)delete o.material.userData.pbrFamily;}));
  const count=l=>{let sum=0;l.traverse(o=>{if(o.geometry)sum+=o.geometry.index.count;});return sum;};
  const before=a.lods.map(count),bounds=a.lods.map(l=>new Box3().setFromObject(l));
  const expected=[];
  a.lods[0].traverse(o=>{if(o.material){const c=o.geometry.attributes.color;expected.push([(o.material.vertexColors?c.getX(0):1)*o.material.color.r,(o.material.vertexColors?c.getY(0):1)*o.material.color.g,(o.material.vertexColors?c.getZ(0):1)*o.material.color.b,o.geometry.attributes.position.count]);}});
  const b=compactPlant(a);
  assert.deepEqual(b.lods.map(count),before);
  for(let i=0;i<3;i++){assert.equal(b.lods[i].children.length,1);const box=new Box3().setFromObject(b.lods[i]);assert.ok(box.min.distanceTo(bounds[i].min)<1e-6);assert.ok(box.max.distanceTo(bounds[i].max)<1e-6);}
  let offset=0;const colors=b.object3D.children[0].geometry.attributes.color;
  for(const[r,g,bl,n]of expected){assert.ok(new Vector3().fromBufferAttribute(colors,offset).distanceTo(new Vector3(r,g,bl))<1e-6);offset+=n;}
  b.dispose();b.dispose();
});

test('generated PBR plants retain distinct surface slots during compaction',()=>{
  const a=generatePlant(createPlantDefinition('flower'));const b=compactPlant(a);
  assert.equal(a,b);assert.deepEqual(b.object3D.children.map(o=>o.material.userData.pbrFamily),['bark','foliage','petal','pollen']);
  b.dispose();
});
