import { generatePlacement } from './placement.js';
self.onmessage = ({data}) => {
  try { self.postMessage({ id:data.id, result:generatePlacement(data.options,data.previous,data.dirty) }); }
  catch (e) { self.postMessage({id:data.id,error:e.message}); }
};
