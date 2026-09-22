import * as THREE from 'three';
import atlas from './grass-atlas-v2.json' with { type: 'json' };

export const GRASS_CARD_LAYOUTS = Object.freeze(['sparseCross','staggeredStar','naturalOffset','denseTuft']);
export const GRASS_CARD_ATLASES = Object.freeze(['meadow-v1']);

const LAYOUTS = Object.freeze({
  sparseCross: {
    angles:[0,60,120], heights:[1,.82,.67], widths:[1,.92,.85],
    offsets:[[0,0],[.025,-.02],[-.03,.02]], leans:[0,.04,-.025], cells:['tall','medium','basal'], lods:[[0,1,2],[0,1],[0]],
  },
  staggeredStar: {
    angles:[0,45,90,135], heights:[1,.83,.68,.58], widths:[1,.92,.86,.8],
    offsets:[[0,0],[.05,-.03],[-.04,.05],[.03,.02]], leans:[0,.04,-.06,.05], cells:['tall','medium','leftFan','basal'], lods:[[0,1,2,3],[0,1,3],[0,1]],
  },
  naturalOffset: {
    angles:[4,39,74,112,151], heights:[1,.88,.73,.64,.55], widths:[.94,1,.83,.92,.72],
    offsets:[[-.1,.03],[.08,-.06],[-.02,.09],[.07,.05],[-.09,-.07]], leans:[0,.025,-.04,.12,-.15], cells:['tall','medium','leftFan','rightFan','basal'], lods:[[0,1,2,3,4],[0,1,3],[0,1]],
  },
  denseTuft: {
    angles:[0,30,60,90,120,150], heights:[1,.9,.79,.71,.6,.53], widths:[.9,1,.93,.83,.8,.76],
    offsets:[[0,0],[.04,-.02],[-.06,.03],[.04,.06],[-.07,-.06],[.05,-.04]], leans:[0,.03,-.03,.065,-.055,.05], cells:['tall','medium','wisps','leftFan','rightFan','basal'], lods:[[0,1,2,3,4,5],[0,1,3,4],[0,1]],
  },
});

export const GRASS_CARD_TEXTURES = Object.freeze(Object.keys(atlas.regions));
export const grassCardCount = layout => LAYOUTS[layout]?.angles.length ?? 0;
export const defaultGrassCardEdit = () => ({position:[0,0,0],rotation:[0,0,0],width:1,height:1,texture:'',flipX:false});

// Layout-keyed, detached data travels through workers, presets and projects.
export function validateGrassCardEdits(input = {}) {
  if(!input || typeof input !== 'object' || Array.isArray(input))throw new TypeError('Grass plane layouts must be an object.');
  for(const key of Object.keys(input))if(!GRASS_CARD_LAYOUTS.includes(key))throw new TypeError(`Unknown grass plane layout: ${key}`);
  const result={};
  const number=(value,min,max)=>{
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new TypeError(`Grass plane value must be between ${min} and ${max}.`);
    return value;
  };
  const vector=(value,min,max)=>{
    if(!Array.isArray(value)||value.length!==3)throw new TypeError('Grass plane transform requires three numbers.');
    return value.map(v=>number(v,min,max));
  };
  for(const layout of GRASS_CARD_LAYOUTS)if(Object.hasOwn(input,layout)){
    if(!Array.isArray(input[layout])||input[layout].length!==grassCardCount(layout))throw new TypeError(`Wrong grass plane count for ${layout}.`);
    result[layout]=input[layout].map(value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid grass plane.');
      const edit={...defaultGrassCardEdit(),...value};
      if(typeof edit.texture!=='string'||edit.texture!==''&&!GRASS_CARD_TEXTURES.includes(edit.texture))throw new TypeError('Unknown grass plane PNG.');
      if(typeof edit.flipX!=='boolean')throw new TypeError('Grass plane flip must be true or false.');
      return {position:vector(edit.position,-3,3),rotation:vector(edit.rotation,-180,180),width:number(edit.width,.1,3),height:number(edit.height,.1,3),texture:edit.texture,flipX:edit.flipX};
    });
  }
  return result;
}

export function grassCardEdits(definition) {
  return definition.grassCardEdits?.[definition.cardLayout] ?? Array.from({length:grassCardCount(definition.cardLayout)},defaultGrassCardEdit);
}

// Work from the unedited, normalized vertices every time. Moving one plane must
// never recenter or resize the other planes, or accumulate transform error.
export function applyGrassCardEdits(geometry, definition) {
  const {cardIndices,basePositions,baseUvs}=geometry.userData;
  const edits=grassCardEdits(definition),position=geometry.attributes.position,uv=geometry.attributes.uv;
  const origin=new THREE.Vector3(),point=new THREE.Vector3(),offset=new THREE.Vector3(),rotation=new THREE.Euler();
  for(const [slot,index] of cardIndices.entries()){
    const edit=edits[index],start=slot*12;
    origin.fromArray(basePositions,start).add(new THREE.Vector3().fromArray(basePositions,start+3)).multiplyScalar(.5);
    offset.set(edit.position[0]*definition.width,edit.position[1]*definition.height,edit.position[2]*definition.width);
    rotation.set(...edit.rotation.map(THREE.MathUtils.degToRad));
    const tex=edit.texture?atlas.regions[edit.texture].uv:null;
    const u0=tex?.[0]??baseUvs[slot*8],v0=tex?.[1]??baseUvs[slot*8+1],u1=tex?.[2]??baseUvs[slot*8+2],v1=tex?.[3]??baseUvs[slot*8+5];
    const left=edit.flipX?u1:u0,right=edit.flipX?u0:u1;
    for(let corner=0;corner<4;corner++){
      point.fromArray(basePositions,start+corner*3).sub(origin);
      point.multiply(new THREE.Vector3(edit.width,edit.height,edit.width)).applyEuler(rotation).add(origin).add(offset);
      position.setXYZ(slot*4+corner,point.x,point.y,point.z);
      uv.setXY(slot*4+corner,corner===0||corner===3?left:right,corner<2?v0:v1);
    }
  }
  position.needsUpdate=true;uv.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
}

function rng(seed) {
  let state=seed>>>0;
  return()=>{state+=0x6d2b79f5;let n=Math.imul(state^state>>>15,state|1);n^=n+Math.imul(n^n>>>7,n|61);return((n^n>>>14)>>>0)/4294967296;};
}

function cardGeometry(definition, layout, level) {
  const random=rng(definition.seed),indices=[],position=[],uv=[],wind=[],color=[];
  const variations=layout.angles.map(()=>[random()*2-1,random()*2-1,random()*2-1]);
  const previewLods=[layout.lods[0].slice(0,Math.max(3,layout.lods[0].length-1)),layout.lods[1].slice(0,2),layout.lods[2].slice(0,1)];
  const selected=definition.__grassQuality==='preview'?previewLods[level]:layout.lods[level];
  for(const cardIndex of selected) {
    const yaw=(layout.angles[cardIndex]+variations[cardIndex][0]*10*definition.cardVariation)*Math.PI/180;
    const width=definition.width*layout.widths[cardIndex]*(1+variations[cardIndex][1]*.15*definition.cardVariation);
    const height=definition.height*layout.heights[cardIndex]*(1+variations[cardIndex][2]*.12*definition.cardVariation);
    const [ox,oz]=layout.offsets[cardIndex],lean=layout.leans[cardIndex]*definition.cardLean*definition.width;
    const ux=Math.cos(yaw),uz=Math.sin(yaw),nx=-uz,nz=ux,base=position.length/3;
    const rootX=ox*definition.width,rootZ=oz*definition.width,half=width*.5;
    position.push(
      rootX-ux*half,0,rootZ-uz*half,
      rootX+ux*half,0,rootZ+uz*half,
      rootX+ux*half+nx*lean,height,rootZ+uz*half+nz*lean,
      rootX-ux*half+nx*lean,height,rootZ-uz*half+nz*lean,
    );
    const cell=definition.seedHeads&&cardIndex===selected[0]?'seeds':layout.cells[cardIndex];
    const [u0,v0,u1,v1]=atlas.regions[cell].uv;
    uv.push(u0,v0,u1,v0,u1,v1,u0,v1);wind.push(0,0,1,1);color.push(1,1,1,1,1,1,1,1,1,1,1,1);indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute('windWeight',new THREE.Float32BufferAttribute(wind,1));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.userData={grassCardLayout:definition.cardLayout,grassAtlas:definition.grassAtlas,grassAtlasRevision:atlas.revision,cards:selected.length,cardIndices:[...selected]};
  return geometry;
}

export function generateGrassCards(definition,{quality='export'}={}) {
  if(!GRASS_CARD_LAYOUTS.includes(definition.cardLayout))throw new TypeError(`Unknown grass card layout: ${definition.cardLayout}`);
  if(!GRASS_CARD_ATLASES.includes(definition.grassAtlas))throw new TypeError(`Unknown grass atlas: ${definition.grassAtlas}`);
  const layout=LAYOUTS[definition.cardLayout];
  const material=new THREE.MeshStandardMaterial({name:'Grass cards',color:definition.leafColor,roughness:1,metalness:0,side:THREE.DoubleSide,alphaTest:.45,alphaToCoverage:true});
  material.userData={pbrFamily:'grassCards',pbrVariant:definition.grassAtlas,grassAtlasRevision:atlas.revision,pbrBaselineTint:'#698446',vegetation:true,wind:true,windStrength:.25,windAttribute:'windWeight'};
  const buildDefinition={...definition,__grassQuality:quality};
  const geometries=[0,1,2].map(level=>cardGeometry(buildDefinition,layout,level));
  const reference=quality==='preview'?cardGeometry({...definition,__grassQuality:'export'},layout,0):geometries[0];
  normalizeGeometries(geometries,definition.width,definition.height,reference);
  if(reference!==geometries[0])reference.dispose();
  for(const geometry of geometries){
    geometry.userData.basePositions=Array.from(geometry.attributes.position.array);
    geometry.userData.baseUvs=Array.from(geometry.attributes.uv.array);
    applyGrassCardEdits(geometry,definition);
  }
  const definitionHash=hashDefinition(definition),lods=[0,1,2].map(level=>{
    const group=new THREE.Group();group.name=`lod${level}`;group.userData={assetType:'plant',archetype:'grass',definitionHash,lod:level,definition:structuredClone(definition),wind:true};
    const mesh=new THREE.Mesh(geometries[level],material);mesh.name='grass_cards';mesh.castShadow=false;mesh.receiveShadow=true;
    mesh.userData={materialSlot:'leaves',wind:true,windAttribute:'windWeight',grassCardLayout:definition.cardLayout,grassAtlas:definition.grassAtlas};group.add(mesh);
    group.userData.triangles=mesh.geometry.index.count/3;group.userData.bounds=new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).toArray();return group;
  });
  let disposed=false;
  return{object3D:lods[0],lods,definition,definitionHash,quality,dispose(){if(disposed)return;disposed=true;lods.forEach(l=>l.children[0].geometry.dispose());material.dispose();}};
}

function normalizeGeometries(geometries,width,height,reference=geometries[0]) {
  const source=reference.boundingBox;
  const size=source.getSize(new THREE.Vector3()),center=source.getCenter(new THREE.Vector3());
  const scaleXZ=width/Math.max(size.x,size.z),scaleY=height/size.y;
  for(const geometry of geometries) {
    const position=geometry.getAttribute('position');
    for(let index=0;index<position.count;index++) position.setXYZ(
      index,(position.getX(index)-center.x)*scaleXZ,(position.getY(index)-source.min.y)*scaleY,(position.getZ(index)-center.z)*scaleXZ,
    );
    position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  }
}

function hashDefinition(definition) {
  let hash=2166136261;
  for(const char of JSON.stringify(definition))hash=Math.imul(hash^char.charCodeAt(0),16777619);
  return`plant-v1-${(hash>>>0).toString(16).padStart(8,'0')}`;
}
