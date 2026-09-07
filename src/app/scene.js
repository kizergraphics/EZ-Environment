import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Tree, TreePreset } from 'ez-environment';
import { Environment } from './environment.js';
import { loadPresetWithTextures } from './textures.js';
import { random } from './environment/random.js';
import { terrainHeight } from './environment/placement.js';
import { applyBiome } from './environment/biomes.js';
import { validateOptions } from './environment/options.js';

export async function createScene(renderer) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x94b9f8, 0.0015);
  const environment = new Environment(applyBiome(validateOptions({composition:'biome',includeAuthoredTree:false,exclusions:[]}),'meadow'));
  scene.add(environment);
  const camera = new THREE.PerspectiveCamera(50,window.innerWidth/window.innerHeight,0.1,2000);
  camera.position.set(80,38,90);
  const controls = new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.minDistance=.1;controls.maxDistance=1000;
  controls.minPolarAngle=.02;controls.maxPolarAngle=Math.PI/2-.005;
  controls.target.set(0,20,0);controls.update();
  const tree = new Tree();
  loadPresetWithTextures(tree,'Ash Medium');
  tree.castShadow=true;tree.receiveShadow=true;scene.add(tree);
  const forest=new THREE.Group();forest.name='Forest';
  let legacyLoading=null;
  const ensureLegacyForest=async()=>{
    if(forest.children.length===24)return;
    if(legacyLoading)return legacyLoading;
    legacyLoading=(async()=>{
      const rng=random(18427),presets=Object.keys(TreePreset).filter(k=>!/Trellis/i.test(k));
      for(let i=0;i<24;i++){
        const t=new Tree(),theta=rng()*Math.PI*2,r=130+rng()*150;
        t.position.set(r*Math.cos(theta),0,r*Math.sin(theta));loadPresetWithTextures(t,presets[Math.floor(rng()*presets.length)],false);
        t.options.seed=Math.floor(rng()*100000);t.generateLODs();forest.add(t);
        if(i%4===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
    })();return legacyLoading;
  };
  scene.add(forest);
  const refreshTreeSources=()=>{
    if(environment.suspendSceneSources)return;
    const trees=environment.options.composition==='legacy'?[tree,...forest.children]:environment.options.includeAuthoredTree?[tree]:[];
    environment.options.treeExclusions=[...(environment.options.treeExclusions||[]).filter(s=>s.source!=='scene-tree'),...trees.map(t=>({source:'scene-tree',type:'circle',x:t.position.x,z:t.position.z,radius:Math.max(1.5,t.options.branch.radius[0]*1.3)}))];
    environment.options.canopySources=[...(environment.options.canopySources||[]).filter(s=>s.source!=='scene-tree'),...trees.map(t=>{const box=new THREE.Box3().setFromObject(t),size=box.getSize(new THREE.Vector3());return{source:'scene-tree',x:t.position.x,z:t.position.z,radius:Math.max(2,size.x*.5,size.z*.5),strength:.9};})];
  };
  const syncSceneVisibility=(mode,lastAuthoredMode=null)=>{
    tree.visible=mode==='tree'||mode==='environment'&&(lastAuthoredMode==='tree'||environment.options.includeAuthoredTree);
    forest.visible=(mode==='tree'||mode==='environment')&&environment.options.composition==='legacy';
    environment.grove.root.visible=mode==='environment';
    refreshTreeSources();
  };
  refreshTreeSources();
  environment.beforeRegenerate=refreshTreeSources;
  environment.onTerrainChanged=options=>{
    for(const t of forest.children)t.position.y=terrainHeight(t.position.x,t.position.z,options);
    tree.position.y=terrainHeight(tree.position.x,tree.position.z,options);
  };
  await environment.initialize();
  return{scene,environment,tree,forest,camera,controls,refreshTreeSources,ensureLegacyForest,syncSceneVisibility};
}
