import * as THREE from 'three';
import { PLANT_PRESETS, PLANT_ARCHETYPES, LEAF_DESIGNS, PLANT_BARK_TYPES, createPlantDefinition } from '../generators/plants.js';
import { ROCK_PRESETS, ROCK_ARCHETYPES, ROCK_SHAPE_PROFILES, createRockDefinition } from '../generators/rocks.js';
import { PRESET_GROUPS, assetLayer, layerSpecies } from '../generators/catalog.js';
import { GenerationClient } from './generation.js';
import { WindController } from '../environment/wind.js';
import { makeSpecies } from '../environment/species.js';
import { LAYERS, QUALITY, validateOptions } from '../environment/options.js';
import { exportAssetPack, exportScenePack, exportGLB, downloadBlob, exportPNG } from '../export/exporters.js';
import { cleanTreeDefinition,prepareTreeProject,commitTreeProject } from './tree-project.js';
import { disposeObject } from '../environment/assets.js';
import { prepareAssetMaterials } from '../materials/pbr.js';
import { awaitTextureReadiness } from '../materials/readiness.js';
import { BIOMES, applyBiome } from '../environment/biomes.js';
import { terrainHeight } from '../environment/placement.js';
import { validateCameras, validateCameraState, validateLastAuthoredMode, chooseGroundPosition } from './viewport.js';

const STORAGE='ez-environment-project-v2';
const title=s=>s.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function action(label,fn,cls='studio-button'){
  const b=el('button',cls,label);b.type='button';b.addEventListener('click',async()=>{
    if(b.disabled)return;b.disabled=true;try{await fn();}catch(e){window.__EZ_ENVIRONMENT__?.studio?.status(e.message,true);}finally{b.disabled=false;window.__EZ_ENVIRONMENT__?.studio?.updateViewportToolbar();}
  });return b;
}
function select(label,options,value,onChange){
  const row=el('label','studio-field');row.append(el('span','',label));const input=el('select');input.setAttribute('aria-label',label);
  const groups=new Map();
  for(const [v,t,group]of options){const o=el('option','',t);o.value=v;if(group){if(!groups.has(group)){const g=el('optgroup');g.label=group;groups.set(group,g);input.append(g);}groups.get(group).append(o);}else input.append(o);}input.value=value;
  input.addEventListener('change',()=>Promise.resolve(onChange(input.value)).catch(e=>window.__EZ_ENVIRONMENT__.studio.status(e.message,true)));row.append(input);return row;
}
function field(label,value,min,max,step,onChange,type='number'){
  const row=el('label','studio-field');row.append(el('span','',label));const input=el('input');input.type=type;input.setAttribute('aria-label',label);
  if(type==='checkbox')input.checked=value;else input.value=value;
  if(type==='number'){input.min=min;input.max=max;input.step=step;}
  input.addEventListener('change',()=>{
    const v=type==='checkbox'?input.checked:type==='number'?Number(input.value):input.value;
    if(type==='number'&&(!Number.isFinite(v)||v<min||v>max)){input.value=value;return;}
    Promise.resolve(onChange(v)).catch(e=>window.__EZ_ENVIRONMENT__.studio.status(e.message,true));
  });row.append(input);return row;
}
function section(label,open=true){const s=el('details','studio-section');s.open=open;s.append(el('summary','',label));const body=el('div','studio-section-body');s.append(body);return {element:s,body};}
const cleanTree=cleanTreeDefinition;

export class Studio {
  constructor(context){
    Object.assign(this,context);this.mode='tree';this.lastAuthoredMode=null;this.assetMode=null;this.lod=0;this.asset=null;this.client=new GenerationClient();this.pending=null;this.previewWind=new WindController(this.environment.options.wind);
    this.definitions={plant:createPlantDefinition('shrub'),rock:createRockDefinition('rock')};this.history=[];this.future=[];this.cameras=validateCameras();this.cleanView=false;
    this.viewportGroup=new THREE.Group();this.scene.add(this.viewportGroup);
    this.statusNode=document.getElementById('studio-status');this.panel=document.getElementById('studio-panel');
    const nav=document.getElementById('mode-nav');
    this.navButtons=[];
    for(const m of ['tree','plant','rock','environment']){const b=action(title(m),()=>this.setMode(m),'mode-button');b.dataset.mode=m;b.setAttribute('aria-pressed',String(m==='tree'));nav.append(b);this.navButtons.push(b);}
    this._saveHandler=()=>this.saveProject();this._openHandler=()=>this.openFile('project');this._fitHandler=()=>this.fit();
    document.getElementById('save-project').addEventListener('click',this._saveHandler);
    document.getElementById('open-project').addEventListener('click',this._openHandler);
    document.getElementById('fit-view').addEventListener('click',this._fitHandler);
    this._cameraUpHandler=()=>this.moveCameraVertical(1);this._cameraDownHandler=()=>this.moveCameraVertical(-1);
    document.getElementById('camera-up').addEventListener('click',this._cameraUpHandler);
    document.getElementById('camera-down').addEventListener('click',this._cameraDownHandler);
    this.environment.onStatus=this._envStatus=s=>{this.statusNode.classList.toggle('loading',!!s.loading);if(s.error)this.status(s.error.message,true);else if(s.loading)this.status('Generating environment…');else{this.status(`${BIOMES[this.environment.options.biome]?.name||'Environment'} ready.`);this.refreshEnvironmentStats();this.syncPreview();this.syncSceneAppearance?.();}};
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.brush={enabled:false,radius:5,strength:-1,layer:'grass'};
    this.brushOutline=new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(96*3),3)),new THREE.LineBasicMaterial({color:0xe4f4ab,depthTest:false,transparent:true,opacity:.95}));this.brushOutline.userData.editorOnly=true;this.brushOutline.frustumCulled=false;this.brushOutline.renderOrder=1000;this.brushOutline.visible=false;this.scene.add(this.brushOutline);
    this._paintHandler=event=>this.paintAt(event);this.renderer.domElement.addEventListener('pointerdown',this._paintHandler);
    this._brushMoveHandler=event=>this.previewBrush(event);this._brushLeaveHandler=()=>this.brushOutline.visible=false;this.renderer.domElement.addEventListener('pointermove',this._brushMoveHandler);this.renderer.domElement.addEventListener('pointerleave',this._brushLeaveHandler);
    this.setupViewport();
    this._keyHandler=e=>{
      if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;
      if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key==='PageUp'||e.key==='PageDown')){
        e.preventDefault();this.moveCameraVertical(e.key==='PageUp'?1:-1);return;
      }
      if(!e.ctrlKey&&!e.metaKey&&e.key.toLowerCase()==='f')this.fit();
      if(!e.ctrlKey&&!e.metaKey&&e.key.toLowerCase()==='h')this.toggleCleanView();
      if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();this.saveProject();}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();(e.shiftKey?this.redo():this.undo()).catch(error=>this.status(error.message,true));}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();this.redo().catch(error=>this.status(error.message,true));}
    };window.addEventListener('keydown',this._keyHandler);
    this.refreshNav();this.status('Local workspace ready. Choose Tree, Plant, Rock, or Environment.');
    const saved=localStorage.getItem(STORAGE)||localStorage.getItem('ez-environment-project-v1');
    if(saved){const restore=action('Restore last workspace',async()=>{await this.loadProject(JSON.parse(saved));restore.remove();});document.getElementById('workspace-actions').append(restore);}
  }
  status(text,error=false){this.statusNode.textContent=text;this.statusNode.classList.toggle('error',error);this.statusNode.setAttribute('role',error?'alert':'status');}
  setupViewport(){
    const styles=document.getElementById('view-style-controls'),actions=document.getElementById('view-action-controls');
    styles.append(select('Appearance',[['naturalistic','Naturalistic'],['photorealistic','Photorealistic']],this.environment.options.appearance,v=>this.envChange({appearance:v},{modified:false})),select('Quality',Object.keys(QUALITY).map(q=>[q,title(q)]),this.environment.options.quality,v=>this.envChange({quality:v},{modified:false})));
    actions.append(select('Camera',[['','Camera'],['overview','Overview'],['ground','Ground-level'],['top','Top'],...Array.from({length:3},(_,i)=>[`view${i}`,`Recall view ${i+1}`]),...Array.from({length:3},(_,i)=>[`save${i}`,`Save view ${i+1}`])], '',async v=>{
      if(v.startsWith('save')){this.cameras.bookmarks[Number(v.slice(4))]={mode:this.mode,camera:this.cameraState()};this.persist();this.status('Camera bookmark saved.');}
      else if(v.startsWith('view')){const b=this.cameras.bookmarks[Number(v.slice(4))];if(b){await this.setMode(b.mode);this.restoreCamera(b.camera);}else this.status('This camera bookmark is empty.');}
      else if(v)this.cameraPreset(v);
      document.querySelector('#view-action-controls select[aria-label="Camera"]').value='';
    }));
    this.undoButton=action('↶',()=>this.undo());this.undoButton.title='Undo (Ctrl+Z)';this.undoButton.setAttribute('aria-label','Undo');
    this.redoButton=action('↷',()=>this.redo());this.redoButton.title='Redo (Ctrl+Shift+Z)';this.redoButton.setAttribute('aria-label','Redo');actions.append(this.undoButton,this.redoButton);
    this.cleanButton=action('Clean view',()=>this.toggleCleanView());this.cleanButton.title='Toggle inspector (H)';this.cleanButton.setAttribute('aria-pressed','false');actions.append(this.cleanButton);
    this.diagnosticsButton=action('Stats',()=>{const hud=document.getElementById('performance-hud');hud.hidden=!hud.hidden;this.diagnosticsButton.setAttribute('aria-pressed',String(!hud.hidden));},'studio-button viewport-secondary');this.diagnosticsButton.setAttribute('aria-pressed','false');actions.append(this.diagnosticsButton);
    const handle=document.getElementById('inspector-resize');
    const resize=x=>{const width=Math.max(290,Math.min(480,window.innerWidth-x));document.documentElement.style.setProperty('--inspector-width',`${width}px`);handle.setAttribute('aria-valuenow',String(Math.round(width)));};
    this._resizeDown=e=>{if(e.button!==0)return;e.preventDefault();handle.setPointerCapture(e.pointerId);this._resizing=true;};
    this._resizeMove=e=>{if(this._resizing)resize(e.clientX);};this._resizeUp=()=>this._resizing=false;
    this._resizeKey=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const width=Number(handle.getAttribute('aria-valuenow'))+(e.key==='ArrowLeft'?20:-20);resize(window.innerWidth-width);};
    handle.addEventListener('pointerdown',this._resizeDown);handle.addEventListener('pointermove',this._resizeMove);handle.addEventListener('pointerup',this._resizeUp);handle.addEventListener('lostpointercapture',this._resizeUp);handle.addEventListener('keydown',this._resizeKey);this.updateViewportToolbar();
  }
  updateViewportToolbar(){
    const options=this.environment.options;
    for(const [label,value] of [['Appearance',options.appearance],['Quality',options.quality]]){const input=document.querySelector(`#view-style-controls select[aria-label="${label}"]`);if(input)input.value=value;}
    if(this.undoButton)this.undoButton.disabled=!this.history.length;if(this.redoButton)this.redoButton.disabled=!this.future.length;
    document.getElementById('paint-indicator').hidden=this.mode!=='environment'||!this.brush.enabled||this.cleanView;
    if(this.mode!=='environment'||!this.brush.enabled||this.cleanView)this.brushOutline.visible=false;
  }
  toggleCleanView(){this.cleanView=!this.cleanView;document.getElementById('root').classList.toggle('clean-view',this.cleanView);this.cleanButton.textContent=this.cleanView?'Show inspector':'Clean view';this.cleanButton.setAttribute('aria-pressed',String(this.cleanView));this.updateViewportToolbar();}
  cameraState(){return{position:this.camera.position.toArray(),target:this.controls.target.toArray(),near:this.camera.near,far:this.camera.far,zoom:this.camera.zoom};}
  restoreCamera(state){const value=validateCameraState(state),damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.camera.position.fromArray(value.position);this.controls.target.fromArray(value.target);this.camera.near=value.near;this.camera.far=value.far;this.camera.zoom=value.zoom;this.camera.updateProjectionMatrix();this.controls.update();this.controls.enableDamping=damping;}
  cameraPreset(preset){
    if(preset==='overview'){this.fit();return;}
    const env=this.mode==='environment',radius=env?this.environment.options.radius:Math.max(1,this.camera.position.distanceTo(this.controls.target)/2),target=this.controls.target;
    if(env)target.set(0,terrainHeight(0,0,this.environment.options),0);
    if(preset==='top')this.camera.position.copy(target).add(new THREE.Vector3(0,radius*2,.02));
    else if(preset==='ground'){const point=env?this.groundCameraPosition():{x:radius*.65,y:target.y+radius*.25,z:radius*.8};this.camera.position.set(point.x,point.y,point.z);if(env)target.set(0,terrainHeight(0,0,this.environment.options)+1.5,0);}
    this.camera.zoom=1;this.restoreCamera(this.cameraState());this.cameras.modes[this.mode]=this.cameraState();
  }
  groundCameraPosition(){
    const options=this.environment.options,obstacles=[],bounds=new Map();
    for(const source of options.treeExclusions||[])if(source.type==='circle')obstacles.push({x:source.x,z:source.z,radius:source.radius,maxY:Infinity});
    for(const chunk of this.environment.placement?.chunks?.values()||[])for(const layer of ['rocks','boulders','plants'])for(const record of chunk.layers[layer]?.records||[]){
      if(!bounds.has(record.species)){
        const asset=this.environment.registry.get(record.species),object=asset?.lods?.[0]||asset?.object3D;
        bounds.set(record.species,object?new THREE.Box3().setFromObject(object):new THREE.Box3(new THREE.Vector3(-2,0,-2),new THREE.Vector3(2,4,2)));
      }
      const box=bounds.get(record.species),height=Math.max(Math.abs(box.min.y),Math.abs(box.max.y))*record.scale[1],horizontal=Math.hypot(Math.max(Math.abs(box.min.x),Math.abs(box.max.x))*record.scale[0],Math.max(Math.abs(box.min.z),Math.abs(box.max.z))*record.scale[2]),tilt=Math.sqrt(Math.max(0,1-record.normal[1]**2));
      if(layer==='plants'&&height<1.5)continue;
      obstacles.push({x:record.position[0],z:record.position[2],radius:horizontal+height*tilt,maxY:record.position[1]+height+horizontal*tilt});
    }
    const point=chooseGroundPosition(options.radius,obstacles);let y=terrainHeight(point.x,point.z,options)+1.7;
    // Extremely dense custom scenes can fill every candidate. Clear finite rock
    // bounds vertically in that case instead of placing the camera inside them.
    if(point.clearance<1.5)for(const obstacle of obstacles)if(Number.isFinite(obstacle.maxY)&&Math.hypot(point.x-obstacle.x,point.z-obstacle.z)<obstacle.radius+1.5)y=Math.max(y,obstacle.maxY+1.7);
    return{x:point.x,y,z:point.z};
  }
  moveCameraVertical(direction){
    if(!this.controls.enabled)return;
    // Scale the step to the visible height for fine movement when inspecting up close.
    const distance=this.camera.position.distanceTo(this.controls.target);
    const step=direction*distance*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*.16/this.camera.zoom;
    this.camera.position.y+=step;
    this.controls.target.y+=step;
    this.controls.update();
  }
  refreshNav(){document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===this.mode)));}
  syncPreview(){
    const preview=this.mode==='environment'?this.lastAuthoredMode:this.mode;
    const height=terrainHeight(0,0,this.environment.options),delta=height-this.viewportGroup.position.y;
    if(delta&&!this._loadingProject){
      if(this.viewportGroup.visible&&['plant','rock'].includes(preview)){
        this.camera.position.y+=delta;this.controls.target.y+=delta;
      }
      for(const mode of ['plant','rock',...(this.mode==='environment'&&['plant','rock'].includes(preview)?['environment']:[])]){
        const saved=this.cameras.modes[mode];if(saved){saved.position[1]+=delta;saved.target[1]+=delta;}
      }
    }
    this.environment.visible=true;
    this.viewportGroup.visible=['plant','rock'].includes(preview)&&this.assetMode===preview;
    this.viewportGroup.position.y=height;
    this.viewportGroup.updateMatrixWorld(true);
    // Keep nearby scenery from covering small authored items. This affects the
    // live color/shadow passes only; seeded placement and exports stay intact.
    const size=this.viewportGroup.visible?new THREE.Box3().setFromObject(this.viewportGroup).getSize(new THREE.Vector3()):null;
    this.environment.lod.uniforms.ezPreviewRadius.value=size?Math.max(3,Math.hypot(size.x,size.z)/2+1.5):0;
    this.syncSceneVisibility?.(this.mode,this.lastAuthoredMode);
  }
  async setMode(mode,{rememberCamera=true}={}){
    if(!['tree','plant','rock','environment'].includes(mode))throw new Error('Unknown editor mode.');
    const previousMode=this.mode,transition=this._modeTransition=(this._modeTransition||0)+1;
    const previousCamera=this.cameraState();
    if(rememberCamera)this.cameras.modes[previousMode]=previousCamera;
    clearTimeout(this.debounce);this.client.cancel();this.mode=mode;this.lod=0;
    if(mode!=='environment')this.lastAuthoredMode=mode;
    this.refreshNav();
    document.getElementById('ui-container').hidden=mode!=='tree';this.panel.hidden=mode==='tree';
    this.controls.minDistance=.1;this.controls.maxDistance=1000;this.controls.minPolarAngle=.02;this.controls.maxPolarAngle=Math.PI/2-.005;
    // Enter the test environment at the same framing as the item just edited.
    const savedCamera=rememberCamera&&mode==='environment'&&previousMode!=='environment'&&this.lastAuthoredMode===previousMode
      ?previousCamera:this.cameras.modes[mode]?structuredClone(this.cameras.modes[mode]):null;
    this.syncPreview();this.syncSceneAppearance?.();this.renderPanel();this.updateViewportToolbar();
    const preview=mode==='environment'?this.lastAuthoredMode:mode;
    if(['plant','rock'].includes(preview))await this.generate(!savedCamera,preview);
    else if(!savedCamera)this.fit();
    if(this._modeTransition!==transition)return;
    if(savedCamera)this.restoreCamera(savedCamera);
    this.persist();if(mode==='environment'||mode==='tree')this.status(mode==='environment'?`${BIOMES[this.environment.options.biome]?.name||'Environment'} ready${this.lastAuthoredMode?` - previewing your ${this.lastAuthoredMode}`:''}.`:'Tree editor ready.');
  }
  async generate(fit=false,mode=this.mode){
    if(this._disposed||!['plant','rock'].includes(mode))return;
    this.status(`Generating ${this.definitions[mode].archetype}…`);
    const promise=this.client.generate(mode,this.definitions[mode]);this.pending=promise;
    let asset;try{asset=await promise;}finally{if(this.pending===promise)this.pending=null;}
    if(!asset)return;if(this._disposed||(this.mode!==mode&&!(this.mode==='environment'&&this.lastAuthoredMode===mode))){asset.dispose();return;}
    this.asset?.dispose();this.previewWind.dispose();this.viewportGroup.clear();this.asset=asset;this.assetMode=mode;this.definitions[mode]=structuredClone(asset.definition);
    this.viewportGroup.add(asset.lods[this.lod]);
    for(const l of asset.lods)l.traverse(o=>{if(o.isMesh){o.castShadow=mode!=='plant';o.receiveShadow=true;if(mode==='plant')this.previewWind.attach(o.material,asset.definition.height,.08,!!o.geometry.attributes.windWeight);}});
    this.syncPreview();
    if(fit)this.fit(this.mode==='environment');
    this.updateAssetStats();this.persist();this.status(`${title(asset.definition.archetype)} ready · ${asset.ms.toFixed(0)} ms generation${asset.placement?.shortfall?` · ${asset.placement.shortfall} cluster members could not fit`:''}`);
  }
  updateAssetStats(){
    if(!this.asset)return;let tris=0;this.asset.lods[this.lod].traverse(o=>{if(o.geometry)tris+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});
    const s=this.panel.querySelector('.asset-stats');if(s)s.textContent=`${Math.round(tris).toLocaleString()} triangles · LOD ${this.lod} · ${this.asset.definitionHash}`;
  }
  snapshot(mode=this.mode){return mode==='environment'?{mode,options:structuredClone(this.environment.options)}:{mode,definition:structuredClone(this.definitions[mode])};}
  remember(snapshot=this.snapshot()){this.history.push(snapshot);if(this.history.length>60)this.history.shift();this.future=[];this.updateViewportToolbar();}
  change(key,value){this.remember();this.definitions[this.mode][key]=value;if(this.mode==='rock'&&key==='shapeProfile')this.definitions.rock.version=2;const preset=this.panel.querySelector('select[aria-label="Preset"]');if(preset)preset.value='';clearTimeout(this.debounce);this.debounce=setTimeout(()=>this.generate().catch(e=>this.status(e.message,true)),100);}
  async restoreSnapshot(snapshot){
    if(snapshot.mode==='environment'){await this.environment.setOptions(snapshot.options);this.syncPreview();this.syncSceneAppearance?.();}
    else this.definitions[snapshot.mode]=structuredClone(snapshot.definition);
    if(this.mode!==snapshot.mode)await this.setMode(snapshot.mode);else if(snapshot.mode!=='environment')await this.generate();
    this.renderPanel();this.updateViewportToolbar();this.persist();
  }
  async travelHistory(from,to){
    if(this.historyBusy||!from.length)return;this.historyBusy=true;clearTimeout(this.debounce);const previous=from.at(-1),current=this.snapshot(previous.mode);
    try{await this.restoreSnapshot(previous);from.pop();to.push(current);this.updateViewportToolbar();}finally{this.historyBusy=false;}
  }
  async undo(){return this.travelHistory(this.history,this.future);}
  async redo(){return this.travelHistory(this.future,this.history);}
  renderPanel(){
    this.panel.replaceChildren();if(this.mode==='tree')return;
    const header=el('div','studio-heading');header.append(el('p','eyebrow',this.mode==='environment'?'SCENE COMPOSITION':'PROCEDURAL AUTHORING'),el('h1','',this.mode==='environment'?'Environment':`${title(this.mode)} Studio`));
    header.append(el('p','studio-description',this.mode==='plant'?'Shape living forms, from low ground cover to branching shrubs.':this.mode==='rock'?'Sculpt pebbles, stones, boulders, and natural clusters.':'Compose a seeded world with layered vegetation and stone.'));this.panel.append(header);
    const body=el('div','studio-scroll');this.panel.append(body);
    if(this.mode==='environment'){this.renderEnvironment(body);return;}
    const mode=this.mode,d=this.definitions[mode],presets=mode==='plant'?PLANT_PRESETS:ROCK_PRESETS;
    const p=section('Starting point');body.append(p.element);
    const selected=presets.find(p=>JSON.stringify(p.definition)===JSON.stringify(d))?.id||'';
    p.body.append(select('Preset',[['','Custom'],...PRESET_GROUPS.flatMap(g=>presets.filter(p=>p.group===g).map(p=>[p.id,p.name,g]))],selected,async id=>{if(!id)return;this.remember();this.definitions[mode]=structuredClone(presets.find(p=>p.id===id).definition);this.renderPanel();await this.generate(true);}));
    const types=mode==='plant'?PLANT_ARCHETYPES:ROCK_ARCHETYPES;
    p.body.append(select('Form',types.map(t=>[t,title(t)]),d.archetype,async type=>{this.definitions[mode]=(mode==='plant'?createPlantDefinition:createRockDefinition)(type);this.renderPanel();await this.generate(true);}));
    p.body.append(field('Seed',d.seed,0,4294967295,1,v=>this.change('seed',v)));
    p.body.append(action('New variation',async()=>{this.definitions[mode].seed=crypto.getRandomValues(new Uint32Array(1))[0];this.renderPanel();await this.generate();}));
    const form=section('Shape & structure');body.append(form.element);
    const add=(key,label,min,max,step)=>form.body.append(field(label,d[key],min,max,step,v=>this.change(key,v)));
    add('height','Height · m',.05,mode==='plant'?8:50,.05);add('width','Width · m',.05,mode==='plant'?8:50,.05);
    if(mode==='plant'){
      if(['grass','coniferSapling','cactus','succulent','cushion','deadwood'].includes(d.archetype)){
        if(d.archetype==='cactus')add('armCount','Arms',0,6,1);
        else {
          if(d.archetype!=='deadwood'&&d.archetype!=='coniferSapling')add('stemCount',d.archetype==='succulent'?'Leaves per ring':d.archetype==='cushion'?'Crowns':'Blades',1,16,1);
          if(d.archetype!=='grass')add('branches',d.archetype==='succulent'?'Leaf rings':d.archetype==='coniferSapling'?'Branch tiers':'Branches',1,20,1);
          if(!['deadwood','succulent'].includes(d.archetype))add('density','Foliage density',.1,2.5,.05);
          if(['coniferSapling','cushion'].includes(d.archetype))add('leafSize','Leaf size · m',.015,.7,.005);
          if(['grass','succulent'].includes(d.archetype))add('curvature','Curvature',0,2,.05);
          if(d.archetype==='grass'){add('bladeWidth','Blade width',.005,.12,.005);form.body.append(field('Seed heads',d.seedHeads,0,1,1,v=>{this.change('seedHeads',v);this.renderPanel();},'checkbox'));}
          if(d.archetype==='cushion')form.body.append(field('Flowering',d.flowering,0,1,1,v=>{this.change('flowering',v);this.renderPanel();},'checkbox'));
        }
      }else{
      if(d.archetype!=='flower')add('stemCount',d.archetype==='fern'?'Fronds':'Stems',1,16,1);
      add('branches','Branches',1,20,1);add('density','Foliage density',.1,2.5,.05);add('leafSize','Leaf size · m',.015,.7,.005);add('curvature','Curvature',0,2,.05);
      if(['shrub','bush','sapling'].includes(d.archetype))add('asymmetry','Asymmetry',0,1,.05);
      if(d.archetype!=='fern')form.body.append(field('Flowering',d.flowering,0,1,1,v=>{this.change('flowering',v);this.renderPanel();},'checkbox'));
      if(d.flowering){if(d.archetype==='flower')add('flowerCount','Flower heads',1,16,1);add('petalCount','Petals',4,16,1);}
      }
      if(!['cactus','deadwood'].includes(d.archetype))form.body.append(select('Leaf design',LEAF_DESIGNS.map(value=>[value,title(value)]),d.leafDesign,v=>this.change('leafDesign',v)));
    }else{
      add('depth','Depth · m',.01,50,.05);if(!['slab','outcrop'].includes(d.archetype)){for(const k of ['roundness','angularity','asymmetry','flattening','displacement'])add(k,title(k),0,1,.05);add('frequency','Surface frequency',.1,10,.1);}
      form.body.append(select('Shape profile',ROCK_SHAPE_PROFILES.map(value=>[value,value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase())]),d.shapeProfile??({pebble:'rounded',rock:'fieldstone',boulder:'irregularBoulder',cluster:'fieldstone',slab:'ledgestone',outcrop:'ledgestone'})[d.archetype],v=>this.change('shapeProfile',v)));
      if(d.archetype==='cluster'){form.body.append(select('Cluster mix',[['pebbles','Pebble patch'],['mixed','Mixed stones'],['outcrop','Boulder outcrop'],['scree','Talus scree']],d.clusterMix,v=>this.change('clusterMix',v)));add('count','Members',1,128,1);add('radius','Cluster radius · m',.1,40,.1);add('spacing','Member spacing · m',0,5,.05);}
      form.body.append(select('Collider',['none','box','sphere','convex'].map(t=>[t,title(t)]),d.colliderMode,v=>this.change('colliderMode',v)));
    }
    const surface=section('Surface');body.append(surface.element);
    for(const key of mode==='plant'?['stemColor','leafColor',...(d.flowering||d.seedHeads?['flowerColor']:[])]:['color'])surface.body.append(field(key==='stemColor'&&d.stemMaterial==='bark'&&d.archetype!=='deadwood'?'Bark tint':title(key),d[key],0,0,0,v=>this.change(key,v),'color'));
    if(mode==='plant'&&d.stemMaterial==='bark'&&d.archetype!=='deadwood')surface.body.append(select('Bark design',PLANT_BARK_TYPES.map(value=>[value,value.replace('Bark','Bark ')]),d.barkType,v=>this.change('barkType',v)));
    if(mode==='rock'){
      for(const [key,label]of [['strata','Strata'],['weatheringAmount','Moss / lichen coverage']])surface.body.append(field(label,d[key]??0,0,1,.05,v=>this.change(key,v)));
      surface.body.append(field('Weathering color',d.weatheringColor??'#657443',0,0,0,v=>this.change('weatheringColor',v),'color'));
    }
    if(mode==='rock'){surface.body.append(field('Roughness',d.roughness,0,1,.05,v=>this.change('roughness',v)));surface.body.append(field('Color variation',d.variation,0,1,.05,v=>this.change('variation',v)));surface.body.append(field('Flat shading',d.flatShading,0,0,0,v=>this.change('flatShading',v),'checkbox'));}
    const preview=section('Preview & level of detail');body.append(preview.element);const lods=el('div','studio-button-row');
    for(let i=0;i<3;i++)lods.append(action(i===0?'Full':`LOD ${i}`,()=>{this.lod=i;this.viewportGroup.clear();if(this.asset)this.viewportGroup.add(this.asset.lods[i]);this.updateAssetStats();}));preview.body.append(lods,el('p','asset-stats','Generating…'));
    preview.body.append(action('Frame asset · F',()=>this.fit()));
    const out=section('Save & use');body.append(out.element);
    this.exportOptions ||= {maxTextureSize:2048,includeInstancedScene:false,includeBakedChunks:false};
    out.body.append(select('Texture resolution',[['512','512 px · compact'],['1024','1024 px · balanced'],['2048','2048 px · high'],['4096','4096 px · original']],String(this.exportOptions.maxTextureSize),v=>this.exportOptions.maxTextureSize=Number(v)));
    out.body.append(action('Save preset JSON',()=>downloadBlob(new Blob([JSON.stringify({format:'ez-asset',version:1,kind:mode,definition:this.definitions[mode]},null,2)],{type:'application/json'}),`${d.archetype}-preset.json`)));
    out.body.append(action('Load preset JSON',()=>this.openFile('asset')));
    out.body.append(el('p','','Models include assigned materials. Packs also include reusable textures and material descriptions.'));
    out.body.append(action('Export GLB',async()=>{await this.ensureAsset();this.exportController=new AbortController();try{downloadBlob(await exportGLB(this.asset.lods[this.lod],{maxTextureSize:this.exportOptions.maxTextureSize,signal:this.exportController.signal}),`${this.asset.definition.archetype}-lod${this.lod}.glb`);}finally{this.exportController=null;}}));
    out.body.append(action('Export asset + LOD pack',async()=>{await this.ensureAsset();this.exportController=new AbortController();try{await exportAssetPack(this.asset,this.asset.definition.archetype,{maxTextureSize:this.exportOptions.maxTextureSize,signal:this.exportController.signal});}finally{this.exportController=null;}}));
    out.body.append(action('Cancel export',()=>this.exportController?.abort()));
    out.body.append(action('Export preview PNG',()=>this.capturePNG?this.capturePNG('viewport'):(this.render(),exportPNG(this.renderer,`${d.archetype}.png`))));
    out.body.append(action('Add to environment',async()=>{
      await this.ensureAsset();const asset=makeSpecies(this.asset.definition.archetype,this.asset.definition);const id=`custom_${mode}_${asset.definitionHash}`;
      const layer=assetLayer(this.asset.definition);
      if(this.environment.registry.has(id)){asset.dispose();await this.envChange({layers:{[layer]:{...this.environment.options.layers[layer],species:id,speciesChoices:[]}}});}else await this.environment.addSpecies(id,asset,layer);
      await this.setMode('environment');this.persist();this.status(`Added ${d.archetype} to the ${layer} layer.`);
    },'studio-button primary'));
    this.updateAssetStats();
  }
  async ensureAsset(){clearTimeout(this.debounce);if(this.pending)await this.pending;await this.generate();if(!this.asset)throw new Error('Generate an asset first.');}
  renderEnvironment(body){
    this.layerStats=new Map();
    if(this.lastAuthoredMode){const preview=section('Your latest asset');body.append(preview.element);preview.body.append(el('p','studio-description',`Previewing your ${this.lastAuthoredMode} in the selected environment.`),action('Frame latest asset',()=>this.fit(true)),action(`Edit ${this.lastAuthoredMode}`,()=>this.setMode(this.lastAuthoredMode)));}
    const o=this.environment.options,biomeSection=section('Biome');body.append(biomeSection.element);
    const grid=el('div','biome-grid');
    for(const [id,biome] of Object.entries(BIOMES)){
      const card=action('',()=>this.applyBiomePreset(id),'biome-card');card.dataset.biome=id;card.setAttribute('aria-label',biome.name);card.setAttribute('aria-pressed',String((o.biome==='woodland'?'forest':o.biome)===id));card.title=biome.subtitle;
      const thumb=el('img');thumb.src=`/images/biomes/${id}.jpg`;thumb.alt='';thumb.loading='lazy';card.append(thumb,el('span','',biome.name));grid.append(card);
    }
    const summary=el('div','biome-summary');this.presetState=el('span','preset-state',o.composition==='legacy'?'Legacy scene':o.modified?'Modified':'Preset');summary.append(this.presetState,action('Reset preset',()=>this.applyBiomePreset(o.biome==='woodland'?'forest':o.biome)));
    biomeSection.body.append(grid,summary,el('p','studio-description',BIOMES[o.biome==='woodland'?'forest':o.biome]?.subtitle||'Choose a complete environment.'));
    biomeSection.body.append(field('World seed',o.seed,0,4294967295,1,v=>this.envChange({seed:v},{modified:false})));
    biomeSection.body.append(field('Keep tree alongside other assets',o.includeAuthoredTree,0,0,0,v=>this.envChange({includeAuthoredTree:v}),'checkbox'));
    const settings=section('Terrain');body.append(settings.element);
    settings.body.append(field('World radius · m',o.radius,16,256,8,v=>this.envChange({radius:v},{modified:false})));
    settings.body.append(select('Landform',[['rolling','Rolling hills'],['dunes','Wind-shaped dunes'],['ridges','Rocky ridges']],o.terrain.form||'rolling',v=>this.envChange({terrain:{...this.environment.options.terrain,form:v}})));
    settings.body.append(field('Terrain height · m',o.terrain.amplitude,0,15,.5,v=>this.envChange({terrain:{...this.environment.options.terrain,amplitude:v}})));
    settings.body.append(field('Terrain wavelength · m',o.terrain.scale,8,150,1,v=>this.envChange({terrain:{...this.environment.options.terrain,scale:v}})));
    const terrainAdvanced=section('Advanced terrain',false);settings.body.append(terrainAdvanced.element);terrainAdvanced.body.append(field('Chunk size · m',o.chunkSize,16,96,8,v=>this.envChange({chunkSize:v},{modified:false})));
    const vegetation=section('Vegetation',false),stone=section('Rocks',false);body.append(vegetation.element,stone.element);
    for(const l of LAYERS){const s=section(title(l),false),opts=o.layers[l];(['grass','flowers','plants'].includes(l)?vegetation:stone).body.append(s.element);
      const counts=el('p','studio-description');s.body.append(counts);this.layerStats.set(l,counts);
      s.body.append(field('Enabled',opts.enabled,0,0,0,v=>this.layerChange(l,'enabled',v),'checkbox'));
      const speciesEntries=layerSpecies(l,o.customSpecies).filter(p=>this.environment.registry.has(p.id)),choices=speciesEntries.map(p=>p.id);
      s.body.append(select('Species',speciesEntries.map(p=>[p.id,title(p.name)]),opts.species,async v=>{await this.envChange({layers:{[l]:{...this.environment.options.layers[l],species:v,speciesChoices:[]}}});this.renderPanel();}));
      s.body.append(field('Density · per m²',opts.density,0,2,.001,v=>this.layerChange(l,'density',v)));
      s.body.append(field('Scale',opts.size,.1,5,.1,v=>this.layerChange(l,'size',v)));
      s.body.append(field('Patchiness',opts.patchiness,0,1,.05,v=>this.layerChange(l,'patchiness',v)));
      s.body.append(field('Minimum spacing · m',opts.minSpacing,0,20,.1,v=>this.layerChange(l,'minSpacing',v)));
      if(l==='grass'){
        s.body.append(field('Blade height',opts.height??1,.1,5,.1,v=>this.layerChange(l,'height',v)));
        s.body.append(field('Blade width',opts.width??1,.1,5,.1,v=>this.layerChange(l,'width',v)));
        s.body.append(field('Grass color',opts.color||'#547d31',0,0,0,v=>this.layerChange(l,'color',v),'color'));
        s.body.append(field('Dryness',opts.dryness??0,0,1,.05,v=>this.layerChange(l,'dryness',v)));
      }
      const advanced=section('Advanced placement',false);s.body.append(advanced.element);
      advanced.body.append(field('Tint brightness',opts.tint??1,0,2,.05,v=>this.layerChange(l,'tint',v)));
      if(choices.length>1){
        advanced.body.append(field('Mix species',!!opts.speciesChoices?.length,0,0,0,async v=>{await this.layerChange(l,'speciesChoices',v?choices.map(id=>({id,weight:1})):[]);this.renderPanel();},'checkbox'));
        for(const entry of opts.speciesChoices||[])advanced.body.append(field(`${title(entry.id)} weight`,entry.weight,.01,100,.25,v=>this.layerChange(l,'speciesChoices',this.environment.options.layers[l].speciesChoices.map(e=>e.id===entry.id?{...e,weight:v}:e))));
      }
      const rules=opts.rules||{};
      for(const [key,label,min,max,step,def] of [['minSlope','Minimum slope · degrees',0,90,1,0],['maxSlope','Maximum slope · degrees',0,90,1,l==='plants'?32:38],['minElevation','Minimum elevation · m',-10000,10000,1,-10000],['maxElevation','Maximum elevation · m',-10000,10000,1,10000],['minMoisture','Minimum moisture',0,1,.05,0],['maxMoisture','Maximum moisture',0,1,.05,1],['minCanopy','Minimum canopy',0,1,.05,0],['maxCanopy','Maximum canopy',0,1,.05,1]])advanced.body.append(field(label,rules[key]??def,min,max,step,v=>this.layerChange(l,'rules',{...this.environment.options.layers[l].rules,[key]:v})));
      advanced.body.append(field('Under-canopy reduction',opts.canopyReduction??0,0,1,.05,v=>this.layerChange(l,'canopyReduction',v)));
      if(['rocks','boulders','pebbles'].includes(l)){
        advanced.body.append(field('Maximum tilt · degrees',opts.maxTilt??38,0,90,1,v=>this.layerChange(l,'maxTilt',v)));
        advanced.body.append(field('Burial depth · scale factor',opts.burialDepth??.025,0,1,.01,v=>this.layerChange(l,'burialDepth',v)));
        advanced.body.append(field('Burial variation',opts.burialVariation??.06,0,1,.01,v=>this.layerChange(l,'burialVariation',v)));
      }
      advanced.body.append(action('Load grayscale density map',()=>this.loadDensityMap(l)));
      if(opts.densityMap){advanced.body.append(el('p','studio-description',`${opts.densityMap.width} × ${opts.densityMap.height} map · black excludes, white allows.`));advanced.body.append(action('Clear density map',async()=>{await this.layerChange(l,'densityMap',null);this.renderPanel();}));}
    }
    const paint=section('Paint density & exclusions',false);vegetation.body.append(paint.element);
    paint.body.append(el('p','studio-description','Enable the brush, then Shift-click the terrain. The outline previews its radius.'));
    paint.body.append(field('Brush enabled',this.brush.enabled,0,0,0,v=>{this.brush.enabled=v;this.updateViewportToolbar();},'checkbox'));
    paint.body.append(select('Paint layer',LAYERS.map(l=>[l,title(l)]),this.brush.layer,v=>this.brush.layer=v));
    paint.body.append(select('Operation',[['-1','Erase density'],['1','Add density'],['path','Exclude every layer']],String(this.brush.strength),v=>this.brush.strength=v==='path'?'path':Number(v)));
    paint.body.append(field('Brush radius · m',this.brush.radius,.5,30,.5,v=>this.brush.radius=v));
    paint.body.append(action('Undo last paint stroke',()=>this.undoPaint()));
    paint.body.append(action('Clear painted masks',async()=>{const current=this.environment.options;await this.envChange({brushes:[],exclusions:current.composition==='legacy'?current.exclusions.filter(s=>s.type==='circle'&&s.x===0&&s.z===0&&s.radius===7):[]});}));
    const lighting=section('Lighting',false);body.append(lighting.element);
    const light=(key,value)=>this.envChange({lighting:{...this.environment.options.lighting,[key]:value}});
    lighting.body.append(field('Sun elevation · degrees',o.lighting.elevation,5,85,1,v=>light('elevation',v)),field('Sun intensity',o.lighting.intensity,0,8,.1,v=>light('intensity',v)),field('Ambient light',o.lighting.ambient,0,4,.1,v=>light('ambient',v)),field('Exposure',o.lighting.exposure,.2,2,.05,v=>light('exposure',v)),field('Haze density',o.lighting.fogDensity,0,.03,.0002,v=>light('fogDensity',v)));
    const atmosphere=section('Atmosphere & wind',false);lighting.body.append(atmosphere.element);
    for(const key of ['sky','horizon','fog','sun'])atmosphere.body.append(field(`${title(key)} color`,o.lighting[key],0,0,0,v=>light(key,v),'color'));
    const wind=(key,value)=>this.envChange({wind:{...this.environment.options.wind,[key]:value}});
    atmosphere.body.append(field('Wind strength',o.wind.strength,0,2,.05,v=>wind('strength',v)),field('Wind frequency',o.wind.frequency,0,5,.1,v=>wind('frequency',v)),field('Gust strength',o.wind.gustStrength??.2,0,1,.05,v=>wind('gustStrength',v)),field('Wind bearing · degrees',Math.round(Math.atan2(o.wind.direction[1],o.wind.direction[0])*180/Math.PI),-180,180,5,v=>{const a=v*Math.PI/180;return wind('direction',[Math.cos(a),Math.sin(a)]);}));
    const output=section('Output',false);body.append(output.element);
    this.renderCameraBookmarks(output.body);
    const pngRow=el('div','studio-button-row');for(const [size,label]of [['viewport','View PNG'],['1080p','1080p PNG'],['4k','4K PNG']])pngRow.append(action(label,()=>this.capturePNG(size)));output.body.append(pngRow);
    this.exportOptions ||= {maxTextureSize:2048,includeInstancedScene:false,includeBakedChunks:false};
    output.body.append(select('Texture resolution',[['512','512 px · compact'],['1024','1024 px · balanced'],['2048','2048 px · high'],['4096','4096 px · original']],String(this.exportOptions.maxTextureSize),v=>this.exportOptions.maxTextureSize=Number(v)));
    output.body.append(field('Include instanced GLB',this.exportOptions.includeInstancedScene,0,0,0,v=>this.exportOptions.includeInstancedScene=v,'checkbox'));
    output.body.append(field('Include baked chunk GLBs',this.exportOptions.includeBakedChunks,0,0,0,v=>this.exportOptions.includeBakedChunks=v,'checkbox'));
    output.body.append(action('Regenerate same seed',()=>this.environment.regenerate()));
    output.body.append(el('p','','Includes textured models, LODs, reusable texture files and a material catalog for Unity.'));
    output.body.append(action('Export environment pack',async()=>{this.exportController=new AbortController();this.status('Exporting trees, assets, and placement records…');try{await exportScenePack(this.environment,[...(this.tree.visible?[this.tree]:[]),...(this.forest.visible?this.forest.children:[])],{...this.exportOptions,signal:this.exportController.signal,treeColliders:true});this.status('Environment pack exported.');}finally{this.exportController=null;}},'studio-button primary'));
    output.body.append(action('Cancel export',()=>this.exportController?.abort()));
    output.body.append(action('Save project JSON',()=>this.saveProject()));
    output.body.append(el('p','studio-description','The pack contains reusable GLBs, three LODs, terrain, placement records, collider metadata, and a versioned manifest.'));
    this.refreshEnvironmentStats();this.updateViewportToolbar();
  }
  refreshEnvironmentStats(){for(const [layer,node]of this.layerStats||[]){const count=this.environment.placement?.count[layer]||0,cap=QUALITY[this.environment.options.quality][layer];node.textContent=`${count.toLocaleString()} accepted · near-preview cap ${cap.toLocaleString()}`;}}
  async envChange(patch,{modified=true,record=true}={}){
    const before=this.snapshot('environment'),edit=this._environmentEdit=(this._environmentEdit||0)+1;
    try{await this.environment.setOptions({...patch,...(modified?{modified:true}:{})});}catch(error){this.updateViewportToolbar();throw error;}
    if(edit!==this._environmentEdit)return;
    if(record)this.remember(before);this.syncPreview();this.refreshTreeSources?.();this.syncSceneAppearance?.();this.updateViewportToolbar();
    if(this.presetState)this.presetState.textContent=this.environment.options.composition==='legacy'?'Legacy scene':this.environment.options.modified?'Modified':'Preset';this.persist();
  }
  async applyBiomePreset(id){await this.envChange(applyBiome(this.environment.options,id),{modified:false});this.renderPanel();}
  renderCameraBookmarks(body){
    const group=section('Camera bookmarks',false);body.append(group.element);
    group.body.append(el('p','studio-description','Save the current camera, then recall it in its original editor mode.'));
    for(let i=0;i<3;i++){const row=el('div','studio-button-row'),entry=this.cameras.bookmarks[i];const recall=action(entry?`View ${i+1} · ${title(entry.mode)}`:`View ${i+1} · empty`,async()=>{const bookmark=this.cameras.bookmarks[i];if(!bookmark)return;await this.setMode(bookmark.mode);this.restoreCamera(bookmark.camera);});recall.disabled=!entry;row.append(recall,action('Save here',()=>{this.cameras.bookmarks[i]={mode:this.mode,camera:this.cameraState()};this.persist();this.renderPanel();}));group.body.append(row);}
  }
  async undoPaint(){
    const entry=[...this.history].reverse().find(s=>s.paint);
    if(!entry)return;const current=this.environment.options,source=entry.options;
    await this.envChange({brushes:structuredClone(source.brushes),exclusions:structuredClone(source.exclusions)});
    const index=this.history.indexOf(entry);if(index>=0)this.history[index]={...entry,paint:false};this.status('Paint stroke undone.');
  }

  loadDensityMap(layer){
    const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg';
    input.addEventListener('change',async()=>{
      const file=input.files[0];if(!file)return;
      let url;
      try{
        if(file.size>16*1024*1024)throw new Error('Density image exceeds 16 MB.');
        url=URL.createObjectURL(file);const img=new Image();img.src=url;await img.decode();
        const scale=Math.min(1,128/Math.max(img.width,img.height)),width=Math.max(1,Math.round(img.width*scale)),height=Math.max(1,Math.round(img.height*scale));
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,width,height);
        const pixels=ctx.getImageData(0,0,width,height).data,data=[];
        for(let i=0;i<pixels.length;i+=4)data.push(Math.round((.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2])*pixels[i+3]/255)/255);
        const r=this.environment.options.radius;await this.layerChange(layer,'densityMap',{width,height,data,origin:[-r,-r],size:[2*r,2*r]});this.renderPanel();this.status('Density map applied to the current world bounds.');
      }catch(e){this.status(e.message,true);}finally{if(url)URL.revokeObjectURL(url);}
    });input.click();
  }
  async layerChange(layer,key,value){await this.envChange({layers:{[layer]:{...this.environment.options.layers[layer],[key]:value}}});}
  async paintAt(event){
    if(this.mode!=='environment'||!this.brush.enabled||!event.shiftKey||event.button!==0)return;
    const box=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
    const hit=this.raycaster.intersectObject(this.environment.ground)[0];if(!hit)return;
    try{const stroke={type:'circle',x:hit.point.x,z:hit.point.z,radius:this.brush.radius,layer:this.brush.layer,strength:this.brush.strength},before={...this.snapshot('environment'),paint:true};
      if(stroke.strength==='path'){delete stroke.strength;delete stroke.layer;await this.envChange({exclusions:[...this.environment.options.exclusions,stroke]},{record:false});}else{await this.envChange({brushes:[...this.environment.options.brushes,stroke]},{record:false});}
      this.remember(before);this.persist();this.status('Paint stroke applied.');
    }catch(e){this.status(e.message,true);}
  }
  previewBrush(event){
    if(this.mode!=='environment'||!this.brush.enabled||this.cleanView){this.brushOutline.visible=false;return;}
    const box=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
    const hit=this.raycaster.intersectObject(this.environment.ground)[0];this.brushOutline.visible=!!hit;if(!hit)return;
    const position=this.brushOutline.geometry.attributes.position;
    for(let i=0;i<96;i++){const a=i/96*Math.PI*2,x=hit.point.x+Math.cos(a)*this.brush.radius,z=hit.point.z+Math.sin(a)*this.brush.radius;position.setXYZ(i,x,terrainHeight(x,z,this.environment.options)+.08,z);}
    position.needsUpdate=true;this.brushOutline.material.color.set(this.brush.strength==='path'?0xf2bc8f:this.brush.strength>0?0xc4e997:0xffd397);
  }
  fit(latest=false){
    let center,size;
    if(this.mode==='environment'&&!latest){center=new THREE.Vector3(0,0,0);size=this.environment.options.radius*1.2;}
    else{const object=(this.mode==='environment'?this.lastAuthoredMode:this.mode)==='tree'?this.tree:this.viewportGroup.children[0];if(!object)return;object.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(object);center=b.getCenter(new THREE.Vector3());size=Math.max(.15,b.getSize(new THREE.Vector3()).length());}
    this.controls.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(size*.85,size*.5,size*.9));this.camera.near=Math.max(.01,size/1000);this.camera.far=Math.max(2000,size*20);this.camera.zoom=1;this.camera.updateProjectionMatrix();this.controls.update();
  }
  project(){this.cameras.modes[this.mode]=this.cameraState();return{format:'ez-environment-project',version:2,mode:this.mode,lastAuthoredMode:this.lastAuthoredMode,plant:structuredClone(this.definitions.plant),rock:structuredClone(this.definitions.rock),tree:cleanTree(this.tree),environment:structuredClone(this.environment.options),cameras:structuredClone(this.cameras)};}
  persist(){try{localStorage.setItem(STORAGE,JSON.stringify(this.project()));}catch(e){this.status(`Autosave unavailable: ${e.message}`,true);}}
  saveProject(){try{downloadBlob(new Blob([JSON.stringify(this.project(),null,2)],{type:'application/json'}),'ez-environment-project.json');this.persist();this.status('Project saved.');}catch(e){this.status(e.message,true);}}
  onTreeChanged(){
    if(this._disposed)return;this.lastAuthoredMode='tree';this.syncPreview();this.refreshTreeSources?.();this.persist();clearTimeout(this.treeChangeTimer);
    this.treeChangeTimer=setTimeout(()=>awaitTextureReadiness(this.tree).then(()=>this.environment.regenerate()).then(()=>this.persist()).catch(e=>this.status(e.message,true)),180);
  }
  async openFile(kind){
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
    input.addEventListener('change',async()=>{const f=input.files[0];if(!f)return;try{
      if(f.size>8*1024*1024)throw new Error('Project file exceeds 8 MB.');const data=JSON.parse(await f.text());
      if(kind==='project')await this.loadProject(data);else{
        if(data.format!=='ez-asset'||data.version!==1||!['plant','rock'].includes(data.kind))throw new Error('Choose an EZ plant or rock preset.');
        this.definitions[data.kind]=(data.kind==='plant'?createPlantDefinition:createRockDefinition)(data.definition.archetype,data.definition);await this.setMode(data.kind);
      }
    }catch(e){this.status(`Could not open file: ${e.message}`,true);}});input.click();
  }
  async loadProject(data){
    if(this._loadingProject)throw new Error('A project is already loading. Please wait.');
    this._loadingProject=true;clearTimeout(this.treeChangeTimer);clearTimeout(this.debounce);this.client.cancel();
    try{return await this._loadProject(data);}finally{this._loadingProject=false;}
  }
  async _loadProject(data){
    if(!data||data.format!=='ez-environment-project'||![1,2].includes(data.version))throw new Error('Unsupported project format/version.');
    if(!['tree','plant','rock','environment'].includes(data.mode||'environment'))throw new Error('Unknown saved editor mode.');
    const lastAuthoredMode=validateLastAuthoredMode(data.lastAuthoredMode,data.mode);
    const options=validateOptions(data.version===1?{...data.environment,composition:'legacy',includeAuthoredTree:true}:data.environment),plant=createPlantDefinition(data.plant.archetype,data.plant),rock=createRockDefinition(data.rock.archetype,data.rock),cameras=validateCameras(data.version===2?data.cameras:undefined);
    const preparedTree=data.tree?prepareTreeProject(data.tree,this.tree):null;
    const currentIds=new Set(this.environment.options.customSpecies.map(c=>c.id));
    const registry=new Map([...this.environment.registry].filter(([id])=>!currentIds.has(id))),created=[];
    try{
      for(const c of options.customSpecies){if(registry.has(c.id))throw new Error('Custom species cannot replace a built-in species.');const a=makeSpecies(c.definition.archetype,c.definition);registry.set(c.id,a);created.push(a);}
      for(const l of Object.values(options.layers))for(const id of [l.species,...l.speciesChoices.map(c=>c.id)])if(!registry.has(id))throw new Error(`Unknown species: ${id}`);
      // Finish every asynchronous preparation before committing the live tree.
      for (const asset of created) await prepareAssetMaterials(asset);
      if (preparedTree) await awaitTextureReadiness(preparedTree);
      if(options.composition==='legacy')await this.ensureLegacyForest?.();
      if(data.version===2){
        const authored=preparedTree||this.tree;
        if(preparedTree){authored.position.copy(this.tree.position);authored.quaternion.copy(this.tree.quaternion);authored.scale.copy(this.tree.scale);authored.updateMatrixWorld(true);}
        const trees=options.composition==='legacy'?[authored,...this.forest.children]:options.includeAuthoredTree?[authored]:[];
        options.treeExclusions=[...options.treeExclusions.filter(s=>s.source!=='scene-tree'),...trees.map(t=>({source:'scene-tree',type:'circle',x:t.position.x,z:t.position.z,radius:Math.max(1.5,t.options.branch.radius[0]*1.3)}))];
        options.canopySources=[...options.canopySources.filter(s=>s.source!=='scene-tree'),...trees.map(t=>{const size=new THREE.Box3().setFromObject(t).getSize(new THREE.Vector3());return{source:'scene-tree',x:t.position.x,z:t.position.z,radius:Math.max(2,size.x*.5,size.z*.5),strength:.9};})];
      }
    }catch(e){created.forEach(a=>a.dispose());if(preparedTree)disposeObject(preparedTree);throw e;}
    const oldRegistry=this.environment.registry,oldOptions=this.environment.options;
    const previousSuspend=this.environment.suspendSceneSources;
    this.environment.registry=registry;this.environment.options=options;this.environment.suspendSceneSources=true;
    try{await this.environment.regenerate();}catch(e){this.environment.registry=oldRegistry;this.environment.options=oldOptions;created.forEach(a=>a.dispose());if(preparedTree)disposeObject(preparedTree);throw e;}
    finally{if(previousSuspend===undefined)delete this.environment.suspendSceneSources;else this.environment.suspendSceneSources=previousSuspend;}
    for(const id of currentIds)oldRegistry.get(id)?.dispose();
    this.definitions={plant,rock};this.lastAuthoredMode=lastAuthoredMode;this.cameras=cameras;this.history=[];this.future=[];
    if(preparedTree){commitTreeProject(this.tree,preparedTree);this.refreshTreeUI?.();}
    this.refreshTreeSources?.();
    await this.setMode(data.mode||'environment',{rememberCamera:false});this.persist();this.status(data.version===1?'Legacy workspace restored. Choose a biome to upgrade its composition.':'Workspace restored.');
  }
  update(time){if(this.viewportGroup.visible&&this.assetMode==='plant'&&this.asset)this.previewWind.update(time,this.environment.options.wind);}
  dispose(){
    if(this._disposed)return;this._disposed=true;clearTimeout(this.debounce);clearTimeout(this.treeChangeTimer);this.exportController?.abort();this.client.dispose();this.asset?.dispose();this.asset=null;this.previewWind.dispose();
    this.renderer.domElement.removeEventListener('pointerdown',this._paintHandler);this.renderer.domElement.removeEventListener('pointermove',this._brushMoveHandler);this.renderer.domElement.removeEventListener('pointerleave',this._brushLeaveHandler);window.removeEventListener('keydown',this._keyHandler);
    this.brushOutline.geometry.dispose();this.brushOutline.material.dispose();this.brushOutline.removeFromParent();const handle=document.getElementById('inspector-resize');handle.removeEventListener('pointerdown',this._resizeDown);handle.removeEventListener('pointermove',this._resizeMove);handle.removeEventListener('pointerup',this._resizeUp);handle.removeEventListener('lostpointercapture',this._resizeUp);handle.removeEventListener('keydown',this._resizeKey);
    document.getElementById('save-project').removeEventListener('click',this._saveHandler);document.getElementById('open-project').removeEventListener('click',this._openHandler);document.getElementById('fit-view').removeEventListener('click',this._fitHandler);
    document.getElementById('camera-up').removeEventListener('click',this._cameraUpHandler);document.getElementById('camera-down').removeEventListener('click',this._cameraDownHandler);
    if(this.environment.onStatus===this._envStatus)this.environment.onStatus=null;
    this.navButtons.forEach(b=>b.remove());this.layerStats?.clear();this.viewportGroup.removeFromParent();
    document.getElementById('view-style-controls').replaceChildren();for(const child of [...document.getElementById('view-action-controls').children])if(child.id!=='fit-view')child.remove();
  }
}
