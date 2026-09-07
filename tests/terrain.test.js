import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster,Vector3,Mesh,MeshBasicMaterial,DoubleSide } from 'three';
import { createTerrainGeometry } from '../src/app/environment/terrain.js';
import { terrainHeight } from '../src/app/environment/placement.js';
import { validateOptions } from '../src/app/environment/options.js';
import { createGrass } from '../src/app/environment/species.js';

test('terrain covers distant scenery and matches analytic placement heights',()=>{
  const o=validateOptions({radius:32,terrain:{amplitude:15,scale:8}}),g=createTerrainGeometry(o),m=new Mesh(g,new MeshBasicMaterial({side:DoubleSide}));m.updateMatrixWorld(true);
  const ray=new Raycaster(),down=new Vector3(0,-1,0);
  for(let x=-30;x<32;x+=3.137)for(let z=-30;z<32;z+=4.219){
    ray.set(new Vector3(x,100,z),down);const hit=ray.intersectObject(m)[0];assert.ok(hit);if(Math.hypot(x,z)<o.radius)assert.ok(Math.abs(hit.point.y-(terrainHeight(x,z,o)-.015))<.025,`height mismatch at ${x},${z}`);
  }
  assert.equal(terrainHeight(100,100,o),0);
  for(const x of [39.9,40.1,200,999]){ray.set(new Vector3(x,100,0),down);assert.ok(ray.intersectObject(m)[0]);}
  assert.equal(g.boundingBox.max.x,1000);g.dispose();m.material.dispose();
});
test('four grass silhouettes retain indexed geometry and progressively smaller LODs',()=>{
  const heights=[];
  for(const variant of ['short','medium','tall','clump']){
    const a=createGrass(variant),counts=a.lods.map(l=>l.children[0].geometry.index.count);
    assert.ok(counts[0]>counts[1]&&counts[1]>counts[2]);
    const g=a.lods[0].children[0].geometry;g.computeBoundingBox();heights.push(g.boundingBox.max.y);a.dispose();
  }
  assert.ok(heights[0]<heights[1]&&heights[1]<heights[2]);
});
