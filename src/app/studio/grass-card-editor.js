import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { applyGrassCardEdits, defaultGrassCardEdit, grassCardCount, grassCardEdits, GRASS_CARD_TEXTURES, validateGrassCardEdits } from '../generators/grass-cards.js';

export const GRASS_LAYOUT_STORAGE='ez-grass-plane-layouts-v1';
const degrees=r=>THREE.MathUtils.radToDeg(r);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

export class GrassCardEditor {
  constructor(studio){
    this.studio=studio;this.active=false;this.selected=0;this.saved={};this.inputs=new Map();
    try{this.saved=validateGrassCardEdits(JSON.parse(localStorage.getItem(GRASS_LAYOUT_STORAGE)||'{}'));}
    catch{this.storageWarning='Saved grass layouts could not be read. Your project files are unchanged.';}
  }
  get definition(){return this.studio.definitions.plant;}
  get available(){return this.studio.mode==='plant'&&this.definition.archetype==='grass'&&this.definition.grassRepresentation==='cards';}
  get editing(){return this.active&&this.available;}
  withSavedLayouts(definition){
    if(definition.archetype!=='grass'||!Object.keys(this.saved).length)return definition;
    return {...definition,grassCardEdits:validateGrassCardEdits({...this.saved,...definition.grassCardEdits})};
  }
  setup(){
    if(this.gizmo)return;
    this.root=new THREE.Group();this.root.userData.editorOnly=true;
    this.pivot=new THREE.Object3D();this.root.add(this.pivot);
    this.outline=new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(12),3)),new THREE.LineBasicMaterial({color:0xffdc70,depthTest:false,transparent:true,opacity:.95}));
    this.outline.renderOrder=2000;this.outline.frustumCulled=false;this.root.add(this.outline);this.studio.scene.add(this.root);
    this.gizmo=new TransformControls(this.studio.camera,this.studio.renderer.domElement);
    this.gizmo.userData.editorOnly=true;this.gizmo.setSize(.75);this.gizmo.setSpace('world');this.studio.scene.add(this.gizmo);
    this.gizmo.addEventListener('dragging-changed',event=>{
      this.studio.controls.enabled=!event.value;this.dragging=event.value;
      if(event.value){this.beforeDrag=this.studio.snapshot('plant');this.dragChanged=false;}
      else if(this.dragChanged){
        this.studio.remember(this.beforeDrag);this.beforeDrag=null;this.dragChanged=false;
        clearTimeout(this.studio.debounce);
        this.studio.generate().catch(error=>this.studio.status(error.message,true));
      }
    });
    this.gizmo.addEventListener('objectChange',()=>{
      if(!this.dragging||!this.editing)return;
      const d=this.definition,origin=this.cardOrigin();if(!origin)return;
      const cards=structuredClone(grassCardEdits(d)),edit=cards[this.selected];
      edit.position=[(this.pivot.position.x-origin.x)/d.width,(this.pivot.position.y-origin.y)/d.height,(this.pivot.position.z-origin.z)/d.width].map(v=>clamp(v,-3,3));
      edit.rotation=[this.pivot.rotation.x,this.pivot.rotation.y,this.pivot.rotation.z].map(v=>clamp(degrees(v),-180,180));
      d.grassCardEdits=validateGrassCardEdits({...d.grassCardEdits,[d.cardLayout]:cards});
      this.dragChanged=true;this.preview();this.sync();
    });
  }
  setActive(active){
    this.active=active;
    if(active){
      this.setup();this.studio.lod=0;this.studio.viewportGroup.clear();
      if(this.studio.asset)this.studio.viewportGroup.add(this.studio.asset.lods[0]);
      this.studio.updateAssetStats();
    }
    this.sync();this.refreshPanel();
  }
  refreshPanel(){
    const scroll=this.studio.panel.querySelector('.studio-scroll')?.scrollTop||0;
    this.studio.renderPanel();const panel=this.studio.panel.querySelector('.studio-scroll');if(panel)panel.scrollTop=scroll;
  }
  mesh(){return this.studio.assetMode==='plant'?this.studio.asset?.lods[0]?.children.find(mesh=>mesh.geometry?.userData.cardIndices):null;}
  cardOrigin(){
    const mesh=this.mesh(),slot=mesh?.geometry.userData.cardIndices.indexOf(this.selected);
    if(slot===undefined||slot<0)return null;
    const positions=mesh.geometry.userData.basePositions;
    return new THREE.Vector3().fromArray(positions,slot*12).add(new THREE.Vector3().fromArray(positions,slot*12+3)).multiplyScalar(.5);
  }
  preview(){
    const d=this.definition;
    if(this.studio.asset?.definition.cardLayout!==d.cardLayout)return;
    for(const lod of this.studio.asset.lods)lod.traverse(mesh=>{
      if(mesh.geometry?.userData.cardIndices)applyGrassCardEdits(mesh.geometry,d);
    });
  }
  change(edit){
    const d=this.definition,cards=structuredClone(grassCardEdits(d));cards[this.selected]={...cards[this.selected],...edit};
    this.studio.change('grassCardEdits',validateGrassCardEdits({...d.grassCardEdits,[d.cardLayout]:cards}));
    this.preview();this.sync();
  }
  async save(done=false){
    await this.studio.ensureAsset();
    const d=this.definition,next=validateGrassCardEdits({...this.saved,[d.cardLayout]:grassCardEdits(d)});
    // Commit only after persistent storage succeeds; a failed write is not "saved".
    localStorage.setItem(GRASS_LAYOUT_STORAGE,JSON.stringify(next));this.saved=next;this.storageWarning=null;
    this.studio.persist();if(done)this.setActive(false);else this.sync();
    this.studio.status(`${d.cardLayout.replace(/([A-Z])/g,' $1')} plane arrangement saved. Other clump layouts are unchanged.`);
  }
  resetLayout(){
    const d=this.definition;
    this.studio.change('grassCardEdits',validateGrassCardEdits({...d.grassCardEdits,[d.cardLayout]:Array.from({length:grassCardCount(d.cardLayout)},defaultGrassCardEdit)}));
    this.preview();this.sync();
  }
  render(body,{el,action,select,field,section,title}){
    this.inputs.clear();this.stateLabel=null;this.pngPreview=null;
    if(!this.available){this.sync();return;}
    const d=this.definition;this.selected=Math.min(this.selected,grassCardCount(d.cardLayout)-1);
    const group=section('Grass plane editor');body.append(group.element);
    this.stateLabel=el('p','studio-description');group.body.append(this.stateLabel);
    if(!this.active){
      group.body.append(action('Edit grass planes',()=>this.setActive(true),'studio-button primary'));this.sync();return;
    }
    const saveButtons=el('div','studio-button-row');
    saveButtons.append(action('Save clump layout',()=>this.save(),'studio-button primary'),action('Save & finish editing',()=>this.save(true)));group.body.append(saveButtons);
    group.body.append(el('p','studio-description','Select a plane, then drag the colored move arrows or rotation rings. Wind is paused while editing.'));
    group.body.append(select('Selected plane',Array.from({length:grassCardCount(d.cardLayout)},(_,i)=>[String(i),`Plane ${i+1}`]),String(this.selected),value=>{this.selected=Number(value);this.sync();this.refreshPanel();}));
    const tools=el('div','studio-button-row');
    for(const [mode,label]of [['translate','Move'],['rotate','Rotate']]){
      const button=action(label,()=>{this.gizmo.setMode(mode);this.refreshPanel();});button.setAttribute('aria-pressed',String(this.gizmo.mode===mode));tools.append(button);
    }
    group.body.append(tools);
    this.pngPreview=el('canvas','grass-plane-preview');this.pngPreview.width=240;this.pngPreview.height=120;this.pngPreview.setAttribute('aria-label','Selected plane PNG preview');group.body.append(this.pngPreview);
    const edit=grassCardEdits(d)[this.selected];
    const add=(key,label,value,min,max,step,callback,type='number')=>{
      const row=field(label,value,min,max,step,callback,type);group.body.append(row);this.inputs.set(key,row.querySelector('input'));
    };
    for(const [index,axis]of ['X','Y','Z'].entries()){
      const size=index===1?d.height:d.width;
      add(`p${index}`,`Move ${axis} · m`,edit.position[index]*size,-3*size,3*size,.01,value=>{
        const position=[...grassCardEdits(this.definition)[this.selected].position];position[index]=value/size;this.change({position});
      });
    }
    for(const [index,axis]of ['X','Y','Z'].entries())add(`r${index}`,`Rotate ${axis} · °`,edit.rotation[index],-180,180,1,value=>{
      const rotation=[...grassCardEdits(this.definition)[this.selected].rotation];rotation[index]=value;this.change({rotation});
    });
    for(const key of ['width','height'])add(key,`Plane ${key} ×`,edit[key],.1,3,.05,value=>this.change({[key]:value}));
    const texture=select('Plane PNG',[['','Original PNG'],...GRASS_CARD_TEXTURES.map(key=>[key,title(key)])],edit.texture,value=>this.change({texture:value}));group.body.append(texture);this.inputs.set('texture',texture.querySelector('select'));
    add('flipX','Flip PNG horizontally',edit.flipX,0,1,1,value=>this.change({flipX:value}),'checkbox');
    const reset=el('div','studio-button-row');reset.append(action('Reset plane',()=>this.change(defaultGrassCardEdit())),action('Reset layout',()=>this.resetLayout()));group.body.append(reset);
    group.body.append(action('Close editor',()=>this.setActive(false)));
    this.sync();
  }
  sync(){
    const d=this.definition;
    if(this.stateLabel&&this.available){
      const saved=this.saved[d.cardLayout],matches=saved&&JSON.stringify(saved)===JSON.stringify(grassCardEdits(d));
      this.stateLabel.textContent=this.storageWarning||`${matches?'Saved arrangement':'Unsaved arrangement'} · ${d.cardLayout.replace(/([A-Z])/g,' $1')}. Save to reuse this layout after switching presets or restarting. Project/preset JSON also includes your plane edits.`;
    }
    if(!this.gizmo)return;
    const mesh=this.mesh(),visible=!!(this.editing&&this.studio.lod===0&&mesh&&this.studio.asset.definition.cardLayout===d.cardLayout);
    this.root.visible=visible;this.gizmo.enabled=visible;
    if(!visible){this.gizmo.detach();return;}
    this.root.position.copy(this.studio.viewportGroup.position);
    const origin=this.cardOrigin();if(!origin){this.gizmo.detach();return;}
    const edit=grassCardEdits(d)[this.selected];
    if(!this.dragging){
      this.pivot.position.copy(origin).add(new THREE.Vector3(edit.position[0]*d.width,edit.position[1]*d.height,edit.position[2]*d.width));
      this.pivot.rotation.set(...edit.rotation.map(THREE.MathUtils.degToRad));
      this.pivot.updateMatrixWorld(true);this.gizmo.attach(this.pivot);
    }
    const slot=mesh.geometry.userData.cardIndices.indexOf(this.selected),source=mesh.geometry.attributes.position,target=this.outline.geometry.attributes.position;
    for(let corner=0;corner<4;corner++)target.setXYZ(corner,source.getX(slot*4+corner),source.getY(slot*4+corner),source.getZ(slot*4+corner));target.needsUpdate=true;
    for(const [key,input]of this.inputs){
      if(input===document.activeElement)continue;
      const value=key[0]==='p'&&key.length===2?edit.position[Number(key[1])]*(key[1]==='1'?d.height:d.width):key[0]==='r'&&key.length===2?edit.rotation[Number(key[1])]:edit[key];
      if(input.type==='checkbox')input.checked=value;else input.value=typeof value==='number'?String(Math.round(value*10000)/10000):value;
    }
    if(this.pngPreview){
      const uv=mesh.geometry.attributes.uv,image=mesh.material.map?.image,canvas=this.pngPreview,context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);
      if(image){
        const u0=uv.getX(slot*4),u1=uv.getX(slot*4+1),v0=uv.getY(slot*4),v1=uv.getY(slot*4+2);
        const width=Math.abs(u1-u0)*image.width,height=(v1-v0)*image.height,scale=Math.min((canvas.width-16)/width,(canvas.height-16)/height);
        context.save();context.translate(canvas.width/2,canvas.height/2);if(edit.flipX)context.scale(-1,1);
        context.drawImage(image,Math.min(u0,u1)*image.width,(1-v1)*image.height,width,height,-width*scale/2,-height*scale/2,width*scale,height*scale);context.restore();
      }
    }
  }
  update(){if(this.root&&this.editing)this.root.position.copy(this.studio.viewportGroup.position);}
  dispose(){
    this.gizmo?.dispose();this.gizmo?.removeFromParent();this.outline?.geometry.dispose();this.outline?.material.dispose();this.root?.removeFromParent();
  }
}
