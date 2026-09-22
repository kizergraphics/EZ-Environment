import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectLoader } from 'three';
import { createPlantDefinition, generatePlant } from '../src/app/generators/plants.js';
import { applyGrassCardEdits, defaultGrassCardEdit, grassCardCount, validateGrassCardEdits } from '../src/app/generators/grass-cards.js';

const edits=layout=>Array.from({length:grassCardCount(layout)},defaultGrassCardEdit);
const vertices=asset=>Array.from(asset.lods[0].children[0].geometry.attributes.position.array);

test('grass plane edits survive JSON and worker serialization, without moving other planes',()=>{
  const cards=edits('naturalOffset');cards[0]={...cards[0],position:[.3,.1,-.2],rotation:[12,43,-8],width:1.3,height:.8,texture:'dry',flipX:true};
  const definition=createPlantDefinition('grass',{cardLayout:'naturalOffset',grassCardEdits:{naturalOffset:cards}});
  const roundTrip=createPlantDefinition('grass',JSON.parse(JSON.stringify(definition)));
  assert.deepEqual(roundTrip,definition);
  const baseline=generatePlant(createPlantDefinition('grass',{cardLayout:'naturalOffset'})),asset=generatePlant(roundTrip);
  try{
    assert.notDeepEqual(vertices(asset).slice(0,12),vertices(baseline).slice(0,12));
    assert.deepEqual(vertices(asset).slice(12),vertices(baseline).slice(12));
    const loaded=new ObjectLoader().parse(asset.lods[0].toJSON());
    assert.deepEqual(loaded.userData.definition.grassCardEdits,definition.grassCardEdits);
    const mesh=loaded.children[0],before=Array.from(mesh.geometry.attributes.position.array);
    applyGrassCardEdits(mesh.geometry,definition);applyGrassCardEdits(mesh.geometry,definition);
    assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),before,'Editing never accumulates transform error');
    loaded.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  }finally{baseline.dispose();asset.dispose();}
});

test('retained planes keep identical edited transforms and UVs across all LODs and preview quality',()=>{
  for(const layout of ['sparseCross','staggeredStar','naturalOffset','denseTuft']){
    const cards=edits(layout);cards.forEach((card,i)=>{card.position=[i*.15,.04,-.2];card.rotation=[10,20+i*5,-15];card.width=1.1;card.height=.85;});
    const definition=createPlantDefinition('grass',{cardLayout:layout,grassCardEdits:{[layout]:cards}});
    const full=generatePlant(definition),preview=generatePlant(definition,{quality:'preview'});
    try{
      const source=full.lods[0].children[0].geometry;
      for(const asset of [full,preview])for(const lod of asset.lods){
        const geometry=lod.children[0].geometry;
        for(const [slot,index]of geometry.userData.cardIndices.entries())for(const [attribute,size]of [['position',12],['uv',8]]){
          assert.deepEqual(Array.from(geometry.attributes[attribute].array.slice(slot*size,(slot+1)*size)),Array.from(source.attributes[attribute].array.slice(index*size,(index+1)*size)),`${layout} ${attribute} plane ${index}`);
        }
      }
    }finally{full.dispose();preview.dispose();}
  }
});

test('saved edits are isolated by layout and reset restores the original geometry',()=>{
  const natural=edits('naturalOffset');natural[1].position[0]=.4;
  const saved={naturalOffset:natural};
  const first=generatePlant(createPlantDefinition('grass',{cardLayout:'denseTuft',grassCardEdits:saved}));
  const baseline=generatePlant(createPlantDefinition('grass',{cardLayout:'denseTuft'}));
  try{assert.deepEqual(vertices(first),vertices(baseline));}finally{first.dispose();baseline.dispose();}
  const reset=generatePlant(createPlantDefinition('grass',{cardLayout:'naturalOffset',grassCardEdits:{naturalOffset:edits('naturalOffset')}}));
  const original=generatePlant(createPlantDefinition('grass',{cardLayout:'naturalOffset'}));
  try{assert.deepEqual(vertices(reset),vertices(original));}finally{reset.dispose();original.dispose();}
  const detached=validateGrassCardEdits(saved);detached.naturalOffset[1].position[0]=.8;assert.equal(saved.naturalOffset[1].position[0],.4);
});

test('malformed saved plane settings reject before changing the workspace',()=>{
  const valid=edits('sparseCross');
  for(const invalid of [null,[],{unknown:valid},JSON.parse('{"__proto__":[]}'),{sparseCross:[]},{sparseCross:[null,...valid.slice(1)]}])assert.throws(()=>validateGrassCardEdits(invalid));
  for(const patch of [{position:[NaN,0,0]},{position:[Infinity,0,0]},{position:[0,0]},{position:[4,0,0]},{rotation:[0,181,0]},{width:0},{height:4},{texture:'constructor'},{texture:'../image.png'},{flipX:'true'}]){
    const cards=edits('sparseCross');Object.assign(cards[0],patch);
    assert.throws(()=>createPlantDefinition('grass',{grassCardEdits:{sparseCross:cards}}));
  }
});
