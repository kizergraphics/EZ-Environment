import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCameraState, validateCameras, validateLastAuthoredMode, chooseGroundPosition } from '../src/app/studio/viewport.js';

test('latest authored asset restores in Environment and supports older projects', () => {
  for (const mode of ['tree', 'plant', 'rock']) {
    assert.equal(validateLastAuthoredMode(mode, 'environment'), mode);
    assert.equal(validateLastAuthoredMode(undefined, mode), mode);
  }
  assert.equal(validateLastAuthoredMode(undefined, 'environment'), null);
  assert.equal(validateLastAuthoredMode(null, 'environment'), null);
  assert.equal(validateLastAuthoredMode('plant', 'rock'), 'rock');
  for (const value of ['environment', 'unknown', {}, 0]) assert.throws(() => validateLastAuthoredMode(value, 'environment'));
});

const state=()=>({position:[10,5,12],target:[0,1,0],near:.01,far:2000,zoom:1});

test('saved mode cameras and bookmarks round-trip independently without caller aliases', () => {
  const input={modes:{environment:state(),tree:{...state(),position:[20,10,20]}},bookmarks:[{mode:'environment',camera:state()},null,null]};
  const result=validateCameras(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(result,input);assert.deepEqual(validateCameras(),{modes:{},bookmarks:[null,null,null]});
  result.modes.environment.position[0]=50;result.bookmarks[0].camera.target[1]=10;
  assert.equal(input.modes.environment.position[0],10);assert.equal(input.bookmarks[0].camera.target[1],1);
  assert.deepEqual(validateCameraState({position:[1,2,3],target:[0,0,0]}),{position:[1,2,3],target:[0,0,0],near:.01,far:2000,zoom:1});
});

test('invalid saved cameras fail before nonfinite transforms or clipping can enter the scene', () => {
  for(const patch of [{position:[0,1,0]},{position:[1,2]},{position:[1,2,Infinity]},{position:[100001,2,3]},{target:['0',0,0]},{near:0},{far:.005},{far:Infinity},{zoom:0},{zoom:NaN}]){
    assert.throws(()=>validateCameraState({...state(),...patch}),undefined,JSON.stringify(patch));
  }
  for(const input of [null,[],{modes:[]},{modes:{unknown:state()}},{bookmarks:[]},{bookmarks:[null,null]},{bookmarks:[{mode:'unknown',camera:state()},null,null]},{bookmarks:[{mode:'tree',camera:{...state(),position:[0,1,0]}},null,null]}]){
    assert.throws(()=>validateCameras(input),undefined,JSON.stringify(input));
  }
});

test('ground camera keeps open framing and deterministically avoids blocked outcrops', () => {
  const radius=96,initial=chooseGroundPosition(radius,[]);
  assert.equal(initial.x,radius*.22);assert.equal(initial.z,radius*.32);
  const obstacles=[{x:initial.x,z:initial.z,radius:8},{x:initial.x*.8,z:initial.z*.8,radius:4}];
  const relocated=chooseGroundPosition(radius,obstacles);
  assert.deepEqual(chooseGroundPosition(radius,structuredClone(obstacles)),relocated);
  assert.notDeepEqual(relocated,initial);assert.ok(relocated.clearance>=1.5);
  assert.ok(obstacles.every(o=>Math.hypot(relocated.x-o.x,relocated.z-o.z)>=o.radius+1.5));
  const filled=chooseGroundPosition(radius,[{x:0,z:0,radius:radius*2}]);
  assert.ok(Number.isFinite(filled.x)&&Number.isFinite(filled.z)&&Number.isFinite(filled.clearance));
  assert.ok(Math.hypot(filled.x,filled.z)<=radius*.55+1e-8);
});
