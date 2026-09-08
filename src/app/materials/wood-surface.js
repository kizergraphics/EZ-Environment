import * as THREE from 'three';
import { registerTextureReadiness } from './readiness.js';

const cache = new Map();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function endgrainPixels(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const dx=x/size-.48,dy=y/size-.52,r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
    const grain=r*83+Math.sin(a*3+r*12)*.7+Math.sin(a*7-r*4)*.25;
    const rings=Math.pow(.5+.5*Math.sin(grain*6.283),9);
    const pore=Math.sin(x*1.37+y*.7)*Math.sin(y*1.93-x*.6);
    let split=0;
    for(const angle of [-2.3,-.4,1.6]) {
      const distance=Math.abs(Math.atan2(Math.sin(a-angle),Math.cos(a-angle)));
      split+=Math.exp(-(((distance+(Math.sin(r*40)*.003))/.012)**2))*Math.max(0,(r-.13)/.4);
    }
    const shade=clamp(211-rings*52+pore*9-split*95,65,240),i=(y*size+x)*4;
    data.set([shade,shade-4,shade-11,255],i);
  }
  return data;
}

function surfaceImages(data,size,id) {
  const luminance=new Float32Array(size*size);let mean=0;
  for(let i=0;i<luminance.length;i++){const p=i*4;luminance[i]=data[p]*.2126+data[p+1]*.7152+data[p+2]*.0722;mean+=luminance[i];}
  mean/=luminance.length;
  const color=new Uint8ClampedArray(data.length),normal=color.slice(),rough=color.slice();
  const sample=(x,y)=>luminance[((y+size)%size)*size+(x+size)%size];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const i=y*size+x,p=i*4,l=luminance[i];
    const shade=id==='endgrain'?l:clamp(213+(l-mean)*1.8,55,255);
    for(let c=0;c<3;c++)color[p+c]=clamp(shade+(data[p+c]-l)*.45,0,255);color[p+3]=255;
    const dx=(sample(x+1,y)-sample(x-1,y))/105,dy=(sample(x,y+1)-sample(x,y-1))/105,len=Math.hypot(dx,dy,1);
    normal.set([127.5*(1-dx/len),127.5*(1+dy/len),127.5*(1+1/len),255],p);
    const r=clamp(221-(l-mean)*.55,165,250);rough.set([r,r,r,255],p);
  }
  return Object.fromEntries(Object.entries({map:color,normalMap:normal,roughnessMap:rough}).map(([slot,pixels])=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;canvas.getContext('2d').putImageData(new ImageData(pixels,size,size),0,0);return[slot,canvas];
  }));
}

/** Synchronous texture handles for tree generation; readiness follows image work. */
export function getWoodMaps(id='wood') {
  if(!['wood','endgrain'].includes(id))throw new Error(`Unknown wood surface ${id}.`);
  if(cache.has(id))return cache.get(id).maps;
  const maps=Object.fromEntries(['map','normalMap','roughnessMap'].map(slot=>{
    const texture=new THREE.Texture();texture.name=`${id}-${slot}`;texture.colorSpace=slot==='map'?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;return[slot,texture];
  }));
  const record={maps};cache.set(id,record);
  record.ready=Promise.resolve().then(async()=>{
    const size=id==='endgrain'?512:1024;let data;
    if(id==='endgrain')data=endgrainPixels(size);
    else {
      const source=await new THREE.TextureLoader().loadAsync('/textures/wood/weathered-grain-v1.png');
      try {const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d');context.drawImage(source.image,0,0,size,size);data=context.getImageData(0,0,size,size).data;}
      finally {source.dispose();}
    }
    const images=surfaceImages(data,size,id);
    for(const [slot,texture]of Object.entries(maps)){texture.image=images[slot];texture.needsUpdate=true;}
    return maps;
  }).catch(error=>{cache.delete(id);throw new Error(`Could not prepare ${id} texture: ${error.message}`);});
  for(const texture of Object.values(maps))registerTextureReadiness(texture,record.ready);
  return maps;
}

export async function loadWoodMaps(id) {getWoodMaps(id);return cache.get(id).ready;}
