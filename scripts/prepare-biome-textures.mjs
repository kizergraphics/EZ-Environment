import { createRequire } from 'node:module';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
const sharp=require(process.env.EZ_SHARP_PATH||'sharp');
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'src/app/public/textures/biomes');
const sources=JSON.parse(await readFile(path.join(root,'assets/biome-texture-sources.json'),'utf8'));
await mkdir(out,{recursive:true});
const qa=[];
for(const item of sources.assets){
  const dest=path.join(out,item.id),sourcePath=path.resolve(root,item.source),bundledSource=path.join(dest,'source.png');await mkdir(dest,{recursive:true});
  if(path.resolve(sourcePath)!==path.resolve(bundledSource))await copyFile(sourcePath,bundledSource);
  const metadata=await sharp(sourcePath).metadata();
  for(const size of [1024,2048]){
    const {data}=await sharp(sourcePath).resize(size,size).removeAlpha().raw().toBuffer({resolveWithObject:true});
    // Enforce periodic boundary continuity with a narrow blend; retain the generated source.
    const band=Math.round(size*.04);
    for(let y=0;y<size;y++)for(let k=0;k<band;k++)for(let c=0;c<3;c++){
      const a=(y*size+k)*3+c,b=(y*size+size-1-k)*3+c,t=(1-k/band)*.5,v=data[a],w=data[b];data[a]=Math.round(v*(1-t)+w*t);data[b]=Math.round(w*(1-t)+v*t);
    }
    for(let x=0;x<size;x++)for(let k=0;k<band;k++)for(let c=0;c<3;c++){
      const a=(k*size+x)*3+c,b=((size-1-k)*size+x)*3+c,t=(1-k/band)*.5,v=data[a],w=data[b];data[a]=Math.round(v*(1-t)+w*t);data[b]=Math.round(w*(1-t)+v*t);
    }
    const normal=Buffer.alloc(size*size*3),rough=Buffer.alloc(size*size),height=new Float32Array(size*size);
    for(let i=0;i<height.length;i++)height[i]=(.2126*data[i*3]+.7152*data[i*3+1]+.0722*data[i*3+2])/255;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=y*size+x,dx=(height[y*size+(x+1)%size]-height[y*size+(x+size-1)%size])*1.8,dy=(height[((y+1)%size)*size+x]-height[((y+size-1)%size)*size+x])*1.8,len=Math.hypot(dx,dy,1);
      normal[i*3]=Math.round(127.5-dx/len*127.5);normal[i*3+1]=Math.round(127.5+dy/len*127.5);normal[i*3+2]=Math.round(127.5+127.5/len);rough[i]=Math.round(215+height[i]*35);
    }
    await sharp(data,{raw:{width:size,height:size,channels:3}}).jpeg({quality:92}).toFile(path.join(dest,`color-${size}.jpg`));
    await sharp(normal,{raw:{width:size,height:size,channels:3}}).png().toFile(path.join(dest,`normal-${size}.png`));
    await sharp(rough,{raw:{width:size,height:size,channels:1}}).png().toFile(path.join(dest,`roughness-${size}.png`));
  }
  qa.push({id:item.id,sourceSize:[metadata.width,metadata.height],maps:[1024,2048],note:'Normal and roughness inferred from luminance; 2K is resampled where source is smaller.'});
  console.log('Prepared',item.id);
}
await writeFile(path.join(out,'provenance.json'),JSON.stringify({...sources,assets:sources.assets.map(({source,...asset})=>({...asset,source:'source.png'})),validation:qa},null,2));
