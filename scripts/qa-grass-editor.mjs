import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { checkGrassEditor,checkGrassEditorRestart } from './grass-editor-checks.mjs';

const output='artifacts/grass-plane-editor';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1700,height:1250}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5197/');
  await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready,null,{timeout:180000});
  const saved=await checkGrassEditor(page,output);
  await page.reload();await checkGrassEditorRestart(page,saved);
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/report.json`,JSON.stringify({saved,errors,passed:true},null,2));
}finally{await browser.close();}
