import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Tree } from 'ez-environment';
import { Environment } from './environment.js';
import { loadPresetWithTextures } from './textures.js';
import { terrainHeight } from './environment/placement.js';
import { applyMeadowPreset } from './environment/biomes.js';
import { awaitTextureReadiness } from './materials/readiness.js';

export async function createScene(renderer) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x94b9f8, 0.0015);
  const environment = new Environment(applyMeadowPreset({ exclusions: [] }));
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
  const refreshTreeSources=()=>{
    if(environment.suspendSceneSources)return;
    const trees=environment.options.includeAuthoredTree ? [tree] : [];
    environment.options.treeExclusions=[...(environment.options.treeExclusions||[]).filter(s=>s.source!=='scene-tree'),...trees.map(t=>({source:'scene-tree',type:'circle',x:t.position.x,z:t.position.z,radius:Math.max(1.5,(t.growth?.trunkRadius ?? t.options.branch.radius[0])*1.3)}))];
    environment.options.canopySources=[...(environment.options.canopySources||[]).filter(s=>s.source!=='scene-tree'),...trees.map(t=>{const box=new THREE.Box3().setFromObject(t),size=box.getSize(new THREE.Vector3());return{source:'scene-tree',x:t.position.x,z:t.position.z,radius:Math.max(2,size.x*.5,size.z*.5),strength:.9};})];
  };
  const syncSceneVisibility=(mode,lastAuthoredMode=null)=>{
    tree.visible=mode==='tree'||mode==='environment'&&(lastAuthoredMode==='tree'||environment.options.includeAuthoredTree);
    environment.grove.root.visible=mode==='environment';
    refreshTreeSources();
  };
  refreshTreeSources();
  environment.beforeRegenerate=refreshTreeSources;
  environment.onTerrainChanged=options=>{
    tree.position.y=terrainHeight(tree.position.x,tree.position.z,options);
  };
  await environment.initialize();
  await awaitTextureReadiness(tree);
  return{scene,environment,tree,camera,controls,refreshTreeSources,syncSceneVisibility};
}
