import * as THREE from 'three';

// The connected, overlapping slab layout used by the biome outcrops. Dimensions
// remain normalized here so the authoring generator can size the full formation.
export function formationLayout(seed, random) {
  const rng=random(seed);
  return [[-.35,0,2.8,2.5,3.5],[-1.55,.25,2.2,2.1,2.35],[1.45,.10,2.35,2.2,1.9],[.2,1.15,2.7,1.85,1.25]]
    .map(([x,z,width,depth,height],i)=>({x,z,width,depth,height,base:0,yaw:(rng()-.5)*.35,seed:(seed+i*1597334677)>>>0}));
}

// Indexed chamfered prism: shared rim vertices make each slab a closed surface.
// All LODs keep the ledge footprint and slope; only intermediate rings disappear.
export function slabGeometry(slab, level, strata, random) {
  const rng=random(slab.seed),chamfer=.20+rng()*.11;
  const perimeter=[[-1+chamfer,-1],[1-chamfer*.8,-1],[1,-1+chamfer],[1,.67],[.68,1],[-.74,1],[-1,.66],[-1,-.72]];
  const fractured=perimeter.map(([x,z])=>{const scale=.9+rng()*.2;return [x*scale,z*scale];});
  const rim=level===2?fractured.filter((_,i)=>i!==1&&i!==5):fractured;
  const heights=[[0,.13,.30,.34,.56,.60,.82,1],[0,.34,.60,1],[0,1]][level];
  const slopeX=(rng()-.5)*.45,slopeZ=(rng()-.5)*.3,driftX=(rng()-.5)*.18,driftZ=(rng()-.5)*.12;
  const positions=[],uv=[],indices=[];
  const point=(p,t)=>{
    const weatheredEdge=.25+.75*Math.abs(Math.sin(p[0]*5+p[1]*3+slab.seed));
    const ledge=(t===.30||t===.56?.035:t===.34||t===.60?-.018:0)*strata*weatheredEdge;
    const scale=1-t*.17+ledge,x=p[0]*slab.width*.5*scale+driftX*t*slab.width*.1,z=p[1]*slab.depth*.5*scale+driftZ*t*slab.depth*.1;
    return [x,t*slab.height*(1+slopeX*x/slab.width+slopeZ*z/slab.depth),z];
  };
  for(const t of heights)for(const p of rim){positions.push(...point(p,t));uv.push((p[0]+1)/2,t);}
  const n=rim.length;
  for(let h=0;h<heights.length-1;h++)for(let i=0;i<n;i++){
    const a=h*n+i,b=h*n+(i+1)%n,c=b+n,d=a+n;indices.push(a,c,b,a,d,c);
  }
  for(const t of [0,1]){
    const center=positions.length/3;positions.push(...point([0,0],t));uv.push(.5,.5);
    const start=t?(heights.length-1)*n:0;
    for(let i=0;i<n;i++){const a=start+i,b=start+(i+1)%n;if(t)indices.push(center,b,a);else indices.push(center,a,b);}
  }
  const g=new THREE.BufferGeometry();g.setIndex(indices);g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.rotateY(slab.yaw||0);g.translate(slab.x||0,0,slab.z||0);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
  return g;
}

export function stoneSurface(geometry, d) {
  if(!(d.strata>0||d.weatheringAmount>0))return;
  const p=geometry.attributes.position,n=geometry.attributes.normal,old=geometry.attributes.color,colors=[];
  const base=new THREE.Color(d.color),weather=new THREE.Color(d.weatheringColor||'#657443');
  for(let i=0;i<p.count;i++){
    const band=1-(d.strata||0)*.15*(.5+.5*Math.sin(p.getY(i)/Math.max(.01,d.height)*44+d.seed*.01));
    const patch=.5+.5*Math.sin(p.getX(i)*4+d.seed)*Math.cos(p.getZ(i)*5-d.seed);
    const amount=(d.weatheringAmount||0)*Math.max(0,n.getY(i))**1.5*(.25+.75*patch);
    const tint=new THREE.Color(base.r*(old?.getX(i)??1)*band,base.g*(old?.getY(i)??1)*band,base.b*(old?.getZ(i)??1)*band).lerp(weather,amount);
    if(d.weatheringAmount>0)colors.push(tint.r,tint.g,tint.b);
    else colors.push(tint.r/Math.max(base.r,.00001),tint.g/Math.max(base.g,.00001),tint.b/Math.max(base.b,.00001));
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
}
