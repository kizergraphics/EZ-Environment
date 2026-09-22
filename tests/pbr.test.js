import test from 'node:test';
import assert from 'node:assert/strict';
import { SRGBColorSpace, NoColorSpace, ObjectLoader, Mesh, PlaneGeometry, MeshStandardMaterial } from 'three';
import { generatePlant, createPlantDefinition } from '../src/app/generators/plants.js';
import { getBotanicalMaps, loadPbrFamily, prepareAssetMaterials, assertPbrReady } from '../src/app/materials/pbr.js';

test('botanical PBR preparation supplies valid maps across LODs, retains colors, and owns clones', async()=>{
  const asset=generatePlant(createPlantDefinition('flower'));
  const color=asset.object3D.children[1].material.color.clone();
  assert.throws(()=>assertPbrReady(asset.object3D),/missing map/);
  await prepareAssetMaterials(asset);
  asset.lods.forEach(assertPbrReady);
  const material=asset.object3D.children[1].material,maps=getBotanicalMaps();
  assert.ok(material.color.equals(color));assert.notEqual(material.map,maps.map);
  assert.equal(material.map.colorSpace,SRGBColorSpace);assert.equal(material.normalMap.colorSpace,NoColorSpace);
  assert.equal(material.metalness,0);
  let disposed=0,templateDisposed=0;material.map.addEventListener('dispose',()=>disposed++);maps.map.addEventListener('dispose',()=>templateDisposed++);
  const first=material.map;await prepareAssetMaterials(asset);assert.equal(first,material.map);
  asset.dispose();asset.dispose();assert.equal(disposed,1);assert.equal(templateDisposed,0);
});

test('cancelled preparation leaves original materials untouched',async()=>{
  const asset=generatePlant(createPlantDefinition('flower')),controller=new AbortController();controller.abort();
  await assert.rejects(prepareAssetMaterials(asset,{signal:controller.signal}),{name:'AbortError'});
  assert.equal(asset.object3D.children[0].material.map,null);asset.dispose();
});

test('finished surface validation catches untagged mapless materials and missing UV channels',()=>{
  const mesh=new Mesh(new PlaneGeometry(),new MeshStandardMaterial());
  assert.throws(()=>assertPbrReady(mesh,{requireAll:true}),/missing map/);
  Object.assign(mesh.material,getBotanicalMaps('foliage'));
  assert.equal(assertPbrReady(mesh,{requireAll:true}),true);
  mesh.geometry.deleteAttribute('uv');
  assert.throws(()=>assertPbrReady(mesh,{requireAll:true}),/missing uv coordinates/);
  mesh.geometry.dispose();mesh.material.dispose();
});

test('material descriptors survive validation and reject unknown families',async()=>{
  assert.equal(createPlantDefinition('shrub').stemMaterial,'bark');
  assert.throws(()=>createPlantDefinition('flower',{leafMaterial:'missing'}),/Unknown plant/);
  await assert.rejects(loadPbrFamily('bark',{variant:'Bark999'}),/Unknown bark texture/);
});

test('worker LODs sharing serialized metadata each receive their own ready material maps',async()=>{
  const source=generatePlant(createPlantDefinition('flower'));
  const payload=structuredClone(source.lods.map(lod=>lod.toJSON()));
  const lods=payload.map(json=>new ObjectLoader().parse(json));
  // toJSON metadata may preserve shared identity across separately parsed LODs.
  assert.equal(lods[0].children[0].material.userData,lods[1].children[0].material.userData);
  await prepareAssetMaterials({lods});
  lods.forEach(assertPbrReady);
  assert.notEqual(lods[0].children[0].material.userData,lods[1].children[0].material.userData);
  assert.notEqual(lods[0].children[0].material.map,lods[1].children[0].material.map);
  source.dispose();lods.forEach(lod=>lod.traverse(o=>{o.geometry?.dispose();o.material?.dispose();}));
});

test('full-color grass atlases use a baseline tint instead of being darkened twice',async()=>{
  const asset=generatePlant(createPlantDefinition('grass',{grassRepresentation:'cards'}));
  const material=asset.object3D.children[0].material;
  assert.equal(material.userData.pbrBaselineTint,'#698446');
  assert.equal(material.color.getHexString(),'698446');
  await prepareAssetMaterials(asset);
  assert.equal(material.color.getHexString(),'ffffff');
  asset.lods.forEach(assertPbrReady);
  asset.dispose();
});
