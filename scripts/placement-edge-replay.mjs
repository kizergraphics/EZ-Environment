// CPU-only diagnosis: blank page, GPU disabled, frozen placement worker only.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const output=path.resolve('artifacts/performance'),soak=JSON.parse(await readFile(path.join(output,'soak-report.json'),'utf8'));
const bundle=soak.bundles.find(b=>b.file.startsWith('placement.worker-'));
const code=await readFile(path.join(soak.snapshot,'assets',bundle.file),'utf8');
const options={...soak.options,quality:'high',seed:18430};
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/worker.js'?'text/javascript':'text/html');res.end(req.url==='/worker.js'?code:'<!doctype html><title>CPU worker replay</title>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const report={startedAt:new Date().toISOString(),scope:'GPU-disabled headless Edge blank page; exact frozen worker; no app, canvas, WebGL, or rendering tests.',bundle,sha256:createHash('sha256').update(code).digest('hex'),options};
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--disable-software-rasterizer','--disable-gpu-compositing']});
  const cdp=await browser.newBrowserCDPSession();report.browser=await cdp.send('Browser.getVersion');
  const page=await browser.newPage({viewport:{width:1,height:1}});await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result=await page.evaluate(async options=>{
    const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
    const hash=v=>{const value=typeof v==='string'?v:canonical(v);let h=2166136261;for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);return(h>>>0).toString(16).padStart(8,'0');};
    const rows=[],alternates=[];let baseline;
    for(let i=0;i<30;i++){
      const started=performance.now(),worker=new Worker('/worker.js');
      const data=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=e=>reject(new Error(e.message));worker.postMessage({id:i,options});});worker.terminate();
      if(data.error)throw new Error(data.error);
      const chunks=[...data.result.chunks.values()],rawHash=hash(chunks),optionsHash=hash(data.result.options);
      const row={cycle:i,ms:performance.now()-started,reported:data.result.hash,rawHash,optionsHash,count:data.result.count};rows.push(row);
      if(!baseline)baseline={...data.result,chunks};
      if(rawHash!==baseline.hash||data.result.hash!==rawHash||optionsHash!==hash(options))alternates.push({cycle:i,...data.result,chunks});
    }
    return{rows,optionsHash:hash(options),baseline:alternates.length?baseline:null,alternates};
  },options);
  report.results=result.rows;report.optionsHash=result.optionsHash;report.hashes=[...new Set(result.rows.map(r=>r.reported))];report.alternateCount=result.alternates.length;
  if(result.alternates.length){await writeFile(path.join(output,'edge-placement-baseline.json'),JSON.stringify(result.baseline));for(const alternate of result.alternates)await writeFile(path.join(output,`edge-placement-alternate-${alternate.cycle}.json`),JSON.stringify(alternate));}
  console.log(JSON.stringify({cycles:report.results.length,hashes:report.hashes,optionsHash:report.optionsHash,alternateCount:report.alternateCount,browser:report.browser},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));report.finishedAt=new Date().toISOString();await writeFile(path.join(output,'placement-edge-replay.json'),JSON.stringify(report,null,2));}
