import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { generatePlant,createPlantDefinition } from '../generators/plants.js';
import { generateRock,createRockDefinition } from '../generators/rocks.js';
import { disposeObject } from './assets.js';
import { random, hash } from './random.js';
import { formationLayout } from '../generators/rock-forms.js';
import { prepareAssetMaterials } from '../materials/pbr.js';

function geometricAsset(kind,make){
  const lods=[0,1,2].map(level=>{
    const group=new THREE.Group();group.name=`lod${level}`;
    const pieces=make(level),geometry=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());
    const material = new THREE.MeshStandardMaterial({color:kind==='cactus'?'#6d7950':'#55422e',roughness:1});
    material.userData.pbrFamily = 'bark';
    // Capsule UVs span the whole surface; extra tiling keeps the bark fine.
    material.userData.pbrTextureScale = 4;
    group.add(new THREE.Mesh(geometry,material));return group;
  });
  return {definition:{version:1,archetype:kind},definitionHash:`${kind}-v1`,object3D:lods[0],lods,dispose(){lods.forEach(g=>disposeObject(g));}};
}

// Broad, fractured prisms give formations exposed ledges and flat crowns.
// Each level uses the same chunk layout; only small profile steps are removed.
function outcropSlab(slab,level,sandstone){
  const rng=random(slab.seed),chamfer=.20+rng()*.11;
  const perimeter=[[-1+chamfer,-1],[1-chamfer*.8,-1],[1,-1+chamfer],[1,.67],[.68,1],[-.74,1],[-1,.66],[-1,-.72]];
  const rim=level===2?perimeter.filter((_,i)=>i!==1&&i!==5):perimeter;
  const heights=[[0,.13,.30,.34,.56,.60,.82,1],[0,.34,.60,1],[0,1]][level];
  const slopeX=(rng()-.5)*(sandstone?.10:.32),slopeZ=(rng()-.5)*(sandstone?.10:.24);
  const driftX=(rng()-.5)*.18,driftZ=(rng()-.5)*.12;
  const position=[],uv=[],color=[],index=[];
  const point=(p,t)=>{
    const ledge=sandstone?(t===.30||t===.56?.055:t===.34||t===.60?-.025:0):Math.sin(t*13+slab.seed)*.035;
    const scale=1-t*.17+ledge,x=p[0]*slab.width*.5*scale+driftX*t,z=p[1]*slab.depth*.5*scale+driftZ*t;
    return [x,slab.base+t*slab.height+(slopeX*x+slopeZ*z)*t,z];
  };
  const vertex=(p,u,v,shade)=>{const i=position.length/3;position.push(...p);uv.push(u,v);color.push(shade,shade,shade);return i;};
  // Outward winding follows a clockwise rim when viewed from above (x/z).
  for(let h=0;h<heights.length-1;h++)for(let side=0;side<rim.length;side++){
    const next=(side+1)%rim.length,a=point(rim[side],heights[h]),b=point(rim[next],heights[h]),c=point(rim[next],heights[h+1]),d=point(rim[side],heights[h+1]);
    const length=Math.hypot(b[0]-a[0],b[2]-a[2]),u=side*.83,shade=.91+(side%3)*.025+(sandstone&&h%3===1?.045:0);
    const start=vertex(a,u,a[1]/2,shade);vertex(b,u+length/2,b[1]/2,shade);vertex(c,u+length/2,c[1]/2,shade);vertex(d,u,d[1]/2,shade);
    index.push(start,start+2,start+1,start,start+3,start+2);
  }
  for(const t of [0,1]){
    const center=point([0,0],t),centerIndex=vertex(center,center[0]/2,center[2]/2,.98);
    const cap=rim.map(p=>{const v=point(p,t);return vertex(v,v[0]/2,v[2]/2,.98);});
    for(let i=0;i<cap.length;i++){
      const a=cap[i],b=cap[(i+1)%cap.length];
      if(t===1)index.push(centerIndex,b,a);else index.push(centerIndex,a,b);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
  geometry.setIndex(index);geometry.computeVertexNormals();
  geometry.rotateY(slab.yaw);geometry.translate(slab.x,0,slab.z);
  return geometry;
}

function outcropAsset(kind){
  const sandstone=kind==='sandstone_outcrop';
  const definition=createRockDefinition('boulder',{seed:sandstone?52111:682,color:sandstone?'#bd9b70':'#838480',width:5.6,height:3.5,depth:4,roundness:.06,angularity:.95,flatShading:true,biomeForm:kind,formationRevision:2});
  const layout=formationLayout(definition.seed,random).map((s,i)=>({...s,height:s.height*(sandstone?1:.96),base:-.28-i*.045,yaw:s.yaw*(sandstone?1:.65/.35)}));
  const definitionHash=`rock-formation-${hash(definition)}`;
  const material=new THREE.MeshStandardMaterial({color:definition.color,roughness:definition.roughness,metalness:0,vertexColors:true,flatShading:true});
  material.name=`${kind}-stone`;
  material.userData.pbrFamily = sandstone ? 'sandstone' : 'stone';
  const lods=[0,1,2].map(level=>{
    const parts=layout.map(slab=>outcropSlab(slab,level,sandstone)),geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
    geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData={archetype:'boulder',formationPieces:layout.length};
    const mesh=new THREE.Mesh(geometry,material);mesh.name=kind;mesh.castShadow=true;mesh.receiveShadow=true;
    const group=new THREE.Group();group.name=`lod${level}`;group.userData={definitionHash,archetype:'boulder',lod:level,wind:false};group.add(mesh);return group;
  });
  const bounds=new THREE.Box3().setFromObject(lods[0]),collider={mode:'box',center:bounds.getCenter(new THREE.Vector3()).toArray(),size:bounds.getSize(new THREE.Vector3()).toArray()};
  lods[0].userData.collider=collider;
  let disposed=false;
  return{definition,definitionHash,object3D:lods[0],lods,collider,dispose(){if(disposed)return;disposed=true;lods.forEach(g=>g.children[0].geometry.dispose());material.dispose();}};
}

export function extraSpecies(kind){
  if(kind==='sandstone_outcrop'||kind==='rock_outcrop'){
    const sandstone=kind==='sandstone_outcrop';
    return generateRock(createRockDefinition('outcrop',{
      seed:sandstone?52111:682,
      color:sandstone?'#bd9b70':'#838480',
      surfaceMaterial:sandstone?'sandstone':'stone',
      shapeProfile:'ledgestone',
    }),{variants:true});
  }
  if(kind==='dry_shrub')return generatePlant(createPlantDefinition('shrub',{height:.8,width:1.1,branches:4,stemCount:3,density:.35,leafSize:.055,leafColor:'#8e8b64',barkType:'Bark014'}));
  if(kind==='cactus')return geometricAsset(kind,level=>{
    const n=[12,8,5][level],stem=new THREE.CapsuleGeometry(.18,1.9,3,n);stem.translate(0,1.12,0);const pieces=[stem];
    for(const side of [-1,1]){
      const arm=new THREE.CapsuleGeometry(.12,.55,2,n);arm.rotateZ(side*Math.PI/2);arm.translate(side*.3,.85+side*.2,0);pieces.push(arm);
      const tip=new THREE.CapsuleGeometry(.12,.6,2,n);tip.translate(side*.56,1.18+side*.2,0);pieces.push(tip);
    }return pieces;
  });
  if(kind==='fallen_log'){
    const asset=generatePlant(createPlantDefinition('deadwood',{seed:7105,width:4,height:1.05,branches:1}));
    // Keep the legacy species identifier in packs and saved registry definitions.
    asset.definition={version:1,archetype:kind};asset.definitionHash=`${kind}-v1`;
    return asset;
  }
  const stone={sandstone:['rock',{color:'#c3a37b',angularity:.85,roundness:.18}],desert_pebble:['pebble',{color:'#aa9374'}]}[kind];
  return stone?generateRock(createRockDefinition(stone[0],stone[1]),{variants:true}):null;
}

/** Use precisely the same source hierarchy for preview and every pack format. */
export function selectAssetAppearance(asset, options = {}) {
  if (options.appearance !== 'photorealistic' || options.composition !== 'biome' || !asset.photoLods?.length) return asset;
  return { ...asset, lods: asset.photoLods, object3D: asset.photoLods[0] };
}

export async function addFoliageVariants(registry){
  if(typeof document==='undefined')return;
  const loader=new THREE.TextureLoader();
  const specs=[['fern','fern-frond',1.4,1.05,6],['dry_shrub','dry-shrub',1.2,.95,3],['grass','meadow-foliage',1.35,1.05,3],['grass_tall','meadow-foliage',1.3,1.8,3],['shrub','broadleaf',1.6,1.4,5],['bush','broadleaf',2,1.1,5]];
  const textures=new Map(), created=[];
  try{
    for(const [id,file,width,height,count] of specs){
      if (!registry.has(id)) continue;
      if(!textures.has(file)){const t=await loader.loadAsync(`/textures/biomes/foliage/${file}.png`);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;textures.set(file,t);}
      const asset=registry.get(id),map=textures.get(file);
      asset.photoLods=[0,1,2].map(level=>{
        const parts=[],n=Math.max(2,count-level*2);
        for(let i=0;i<n;i++){
          const g=new THREE.PlaneGeometry(width,height,1,3);g.translate(0,height*.5,0);g.rotateY(i*Math.PI/n);g.setAttribute('windWeight',new THREE.Float32BufferAttribute(Array.from({length:g.attributes.position.count},(_,j)=>g.attributes.position.getY(j)/height),1));parts.push(g);
        }
        const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());const group=new THREE.Group();group.name=`lod${level}`;
        const material = new THREE.MeshStandardMaterial({map,color:'#ffffff',roughness:1,side:THREE.DoubleSide,alphaTest:.45,alphaToCoverage:true});
        material.userData.pbrFamily = 'foliage';
        material.userData.pbrPreserveColorMap = true;
        group.add(new THREE.Mesh(geometry,material));return group;
      });
      const original=asset.dispose;asset.dispose=()=>{original();asset.photoLods.forEach(g=>disposeObject(g));};
      created.push({asset, original});
      await prepareAssetMaterials({ lods: asset.photoLods });
    }
    return {dispose(){textures.forEach(t=>t.dispose());}};
  }catch(error){
    for(const {asset,original} of created){asset.photoLods.forEach(g=>disposeObject(g));delete asset.photoLods;asset.dispose=original;}
    textures.forEach(t=>t.dispose());throw error;
  }
}
