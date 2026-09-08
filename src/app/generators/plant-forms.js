import * as THREE from 'three';

export const EXTRA_PLANT_FORMS = Object.freeze(['grass', 'coniferSapling', 'cactus', 'succulent', 'cushion', 'deadwood']);
export const EXTRA_PLANT_DEFAULTS = {
  grass: { height: .65, width: .65, stemCount: 12, branches: 4, leafSize: .08, density: 1, seedHeads: false, bladeWidth: .025 },
  coniferSapling: { height: 2.2, width: 1.3, stemCount: 1, branches: 7, leafSize: .075, density: .8, leafColor: '#496845' },
  cactus: { height: 2.6, width: 1.25, stemCount: 3, branches: 3, leafColor: '#6d7950', stemColor: '#6d7950', armCount: 2 },
  succulent: { height: .75, width: 1.4, stemCount: 12, branches: 3, leafSize: .4, leafColor: '#77938b' },
  cushion: { height: .16, width: 1, stemCount: 12, branches: 5, leafSize: .045, density: .9, leafColor: '#64743d' },
  deadwood: { height: .65, width: 3.2, stemCount: 1, branches: 3, stemColor: '#a58c70', leafColor: '#67503a' },
};

// Normalized botanical skeletons use the same meshing, wind and export path as
// legacy plants. Seeded structure is built once and simplified across all LODs.
export function buildPlantForm(d, { range, addStem, addLeaf, radial, curvedPath, flower, model }) {
  const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
  const golden = 2.399963229728653;
  if (d.archetype === 'grass') {
    const count = Math.max(4,Math.round(d.stemCount * d.density * 2));
    for(let i=0;i<count;i++) {
      const a=i*golden, root=radial(a,Math.sqrt(i/count)*.18), h=range(.45,1);
      const blade={position:root,direction:radial(a,range(.12,.5),h).normalize(),length:h,width:d.bladeWidth,
        twist:range(-.25,.25),fold:d.curvature*.025,tint:range(.8,1.15)};
      model.leaves.push(blade);
      if(d.seedHeads && i%3===0) {
        const tip=root.clone().add(radial(a,.12,h*1.1));
        addStem(curvedPath(root,tip,radial(a,.025*d.curvature)),.003,0);
        for(let j=0;j<8;j++) {
          const p=tip.clone().add(V(0,-j*.016,0));
          for(const sign of [-1,1]) model.petals.push({position:p,direction:radial(a+sign*1.3,1,.8).normalize(),length:.035,width:.012,twist:0,fold:.1,tint:range(.9,1.1)});
        }
      }
    }
  } else if(d.archetype==='coniferSapling') {
    addStem(curvedPath(V(),V(d.asymmetry*.06,1,0),V(.015,0,0)),.027,0);
    for(let tier=0;tier<d.branches;tier++) {
      const y=.14+tier/d.branches*.72, reach=(1-y)*.52;
      for(let b=0;b<5;b++) {
        const a=b*Math.PI*2/5+tier*golden, start=V(d.asymmetry*.06*y,y,0), tip=start.clone().add(radial(a,reach,range(-.025,.055)));
        addStem(curvedPath(start,tip,V(0,.018,0)),.006*(1-y*.5),1);
        const sprays=5+Math.round(d.density*6);
        for(let s=0;s<sprays;s++) {
          const t=(s+1)/sprays,p=start.clone().lerp(tip,t);
          for(const side of [-1,1]) {
            const q=p.clone().add(radial(a+side*.9,.065*(1-t*.65),.015));
            addStem([p,q],.0014,2);
            for(let n=0;n<5;n++) addLeaf(p.clone().lerp(q,n/5),radial(a+side*(.7+n*.22),1,.25),d.leafSize*range(.6,1),.007,0,.03);
          }
        }
      }
    }
    for(let i=0;i<16;i++)addLeaf(V(d.asymmetry*.06,.87+i*.008,0),radial(i*golden,.4,1),d.leafSize,.007,0,.03);
  } else if(d.archetype==='cactus') {
    addStem(curvedPath(V(),V(0,1,0),V(.018*d.asymmetry,0,0),12),.115,0);Object.assign(model.stems.at(-1),{taper:.08,rounded:true});
    for(let i=0;i<d.armCount;i++) {
      const a=i*golden+.3, y=.27+(i%3)*.14, elbow=radial(a,.29,y), end=radial(a,.29,y+range(.22,.39));
      const path=curvedPath(elbow,end,V(0,0,0),8);
      addStem([V(0,y,0),radial(a,.16,y-.03),...path],.072,0);Object.assign(model.stems.at(-1),{taper:.18,rounded:true});
    }
  } else if(d.archetype==='succulent') {
    for(let ring=0;ring<d.branches;ring++) for(let i=0;i<d.stemCount;i++) {
      const a=i*golden+ring*.37, inner=ring/Math.max(1,d.branches-1);
      addLeaf(V(0,.015+inner*.08,0),radial(a,1-inner*.65,.2+inner*1.2),range(.46,.62)*(1-inner*.35),.11*(1-inner*.35),range(-.1,.1),.35+d.curvature*.08);
    }
  } else if(d.archetype==='cushion') {
    const crowns=Math.max(1,Math.round(d.stemCount*d.density*(d.flowering?3:6)));
    for(let c=0;c<crowns;c++) {
      const a=c*golden,r=Math.sqrt(c/crowns)*.48,base=radial(a,r),h=.035+Math.sqrt(Math.max(0,1-r*r*4))*.15;
      const top=base.clone().add(V(0,h,0));addStem([base,top],.003,0);
      for(let i=0;i<d.branches;i++)addLeaf(base.clone().lerp(top,(i+1)/d.branches),radial(a+i*golden,1,.35),d.leafSize*range(.7,1.1)*(d.flowering?1:2.8),d.leafSize*(d.flowering?.3:1.1),0,.12);
      if(d.flowering&&c%3===0)flower(top,.026,V(.1,0,.1),5);
    }
  } else if(d.archetype==='deadwood') {
    addStem([V(-.5,.085,0),V(-.18,.1,.01),V(.2,.095,-.015),V(.5,.08,.015)],.085,0);model.stems.at(-1).taper=.3;
    for(let i=0;i<d.branches;i++) {
      const x=-.3+i/Math.max(1,d.branches-1)*.6,side=i%2?1:-1;
      addStem([V(x,.1,0),V(x+.06,.16,side*.08),V(x+.12,range(.18,.25),side*.18)],.026,1);model.stems.at(-1).taper=.7;
    }
  } else return false;
  return true;
}
