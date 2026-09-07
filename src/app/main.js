import * as THREE from 'three';
import { setupUI } from './ui.js';
import { createScene } from './scene.js';
import { Studio } from './studio/studio.js';
import { updateTreeWind } from './environment/wind.js';
import { createRenderPipeline } from './rendering.js';

async function start(){
  const container=document.getElementById('app');
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(Math.max(1,container.clientWidth),Math.max(1,container.clientHeight),false);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const context=await createScene(renderer);
  const {scene,environment,tree,forest,camera,controls}=context;
  let studio;
  const renderPipeline=createRenderPipeline({...context,renderer,container,getMode:()=>studio?.mode});
  const {render,syncSceneAppearance,capturePNG}=renderPipeline;
  const treeUI=setupUI(tree,environment,renderer,scene,camera,controls,'Ash Medium',()=>studio?.onTreeChanged());
  studio=new Studio({...context,renderer,render,syncSceneAppearance,capturePNG,refreshTreeUI:treeUI.refresh});
  const app={...context,renderer,studio,renderPipeline,ready:false,get mode(){return studio.mode;},render,syncSceneAppearance,capturePNG};
  window.__EZ_ENVIRONMENT__=app;
  const clock=new THREE.Clock(),hud=document.getElementById('performance-hud');
  let frames=0,lastHUD=performance.now(),lastFrame=performance.now();
  const timings=new Float64Array(1800);let timingIndex=0;
  function animate(){
    const now=performance.now(),t=clock.getElapsedTime();timings[timingIndex++%timings.length]=now-lastFrame;lastFrame=now;
    if(environment.visible)environment.update(t,camera);
    if(tree.visible)updateTreeWind(tree,environment.wind,camera,t);
    if(forest.visible)for(const o of forest.children)if(o.visible)updateTreeWind(o,environment.wind,camera,t);
    studio.update(t);controls.update();render();frames++;
    if(now-lastHUD>500){if(hud)hud.textContent=`${Math.round(frames*1000/(now-lastHUD))} FPS  ·  ${renderer.info.render.calls} draws  ·  ${Math.round(renderer.info.render.triangles/1000)}k triangles`;frames=0;lastHUD=now;}
    requestAnimationFrame(animate);
  }
  document.getElementById('close-about').addEventListener('click',()=>document.getElementById('aboutOverlay').classList.remove('active'));
  await studio.setMode('environment');
  context.syncSceneVisibility?.('environment');
  syncSceneAppearance();
  renderPipeline.resize();render();
  app.ready=true;
  document.getElementById('loading-screen').hidden=true;
  animate();
  app.runBenchmark=async({duration=30000,warmup=10000,replay=true}={})=>{
    const previous=controls.enabled;controls.enabled=false;
    const savedPosition=camera.position.clone(),savedTarget=controls.target.clone();
    const points=[],cpu=[],draws=[],triangles=[];
    await new Promise(r=>setTimeout(r,warmup));
    const started=performance.now();let last=started;
    await new Promise(resolve=>{
      function sample(){
        const now=performance.now(),elapsed=now-started;
        if(replay){const a=elapsed/duration*Math.PI*2;camera.position.set(Math.cos(a)*80,30+15*Math.sin(a*.5),Math.sin(a)*80);controls.target.set(0,5,0);controls.update();}
        points.push(now-last);last=now;cpu.push(environment.stats.updateMs);draws.push(renderer.info.render.calls);triangles.push(renderer.info.render.triangles);
        if(elapsed>=duration)resolve();else requestAnimationFrame(sample);
      }requestAnimationFrame(sample);
    });
    controls.enabled=previous;camera.position.copy(savedPosition);controls.target.copy(savedTarget);controls.update();
    const summarize=arr=>{arr.sort((a,b)=>a-b);return{average:arr.reduce((a,b)=>a+b,0)/arr.length,median:arr[Math.floor(arr.length*.5)],p95:arr[Math.floor(arr.length*.95)],p99:arr[Math.floor(arr.length*.99)]};};
    return{mode:studio.mode,seed:environment.options.seed,biome:environment.options.biome,appearance:environment.options.appearance,quality:environment.options.quality,renderSettings:renderPipeline.settings,resolution:[renderer.domElement.width,renderer.domElement.height],dpr:renderer.getPixelRatio(),userAgent:navigator.userAgent,replay,duration,warmup,frames:points.length,frameMs:summarize(points),environmentCPU:summarize(cpu),drawCalls:summarize(draws),triangles:summarize(triangles),resources:{...renderer.info.memory},placementHash:environment.placement.hash};
  };
}
document.addEventListener('DOMContentLoaded',()=>start().catch(error=>{
  console.error(error);
  const loading=document.getElementById('loading-screen');loading.replaceChildren();
  const message=document.createElement('p');message.textContent='Could not open the workspace: '+error.message;loading.append(message);
  const retry=document.createElement('button');retry.textContent='Retry';retry.addEventListener('click',()=>location.reload());loading.append(retry);
}));
