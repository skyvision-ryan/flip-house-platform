import assert from 'node:assert/strict';
import test from 'node:test';
import { canActOn, actionMode, actionHref, nextUpFlash } from './stepActions.ts';
import { setLanguage } from '../i18n/core.ts';
import { eventText } from '../i18n/taskDisplay.ts';
import type { StepItem, Steps, TaskEvent } from '../api/client.ts';
const item = (key: string, kind: string, owners: string[], detail: object = {}) => ({ key, owners, confirm: [], confirmed: [], deliverable: { kind, ...detail } }) as StepItem;
const role = (actor: string) => ({actor, can: () => false});
test('photo, typed-document, field and record ports remain distinct stable actions', () => {
  const photo=item('view','photo',['L'],{doc_type:'photo'});
  const permit=item('permit_apply','file',['Z'],{doc_type:'permit_application'});
  assert.equal(actionMode(photo),'upload');assert.equal(actionMode(permit),'upload');
  assert.equal(actionHref(9,photo),'/projects/9?tab=overview&step=view&action=upload');
  assert.equal(actionHref(9,permit),'/projects/9?tab=overview&step=permit_apply&action=upload');
  assert.equal(actionHref(9,item('screen','field',['J'],{field:'risks'})),'/projects/9?tab=overview&step=screen&action=field');
  assert.equal(actionHref(9,item('utilities_on','record',['K'],{record:'utilities'})),'/projects/9?tab=data&section=utilities');
});
test('Permit and assistant aliases mirror existing file duties, without financial or gate rights', () => {
  assert.equal(canActOn(item('permit_apply','file',['Z'],{doc_type:'permit_application'}),role('Permit/设计')),true);
  assert.equal(canActOn(item('design','file',['设计师'],{doc_type:'drawing'}),role('Permit/设计')),true);
  assert.equal(canActOn(item('loan_insurance','file',['J','K'],{doc_type:'insurance'}),role('项目助理')),true);
  assert.equal(canActOn(item('loan_doc','file',['D','L'],{doc_type:'loan_doc'}),role('Permit/设计')),false);
  assert.equal(canActOn(item('view','photo',['L']),role('Permit/设计')),false);
  assert.equal(canActOn(item('price','field',['D'],{field:'purchase_price'}),role('项目助理')),false);
});
test('evidence notices never call a photo proof of permanently finished construction', () => {
  const ev={kind:'evidence_satisfied',after:{mode:'record'},text:'',reason:null} as TaskEvent;
  setLanguage('en');assert.match(eventText(ev),/ongoing work still needs follow-up/);
  const steps={next_up:[{title:'申请 permit',owners:['Z']}]} as unknown as Steps;
  assert.equal(nextUpFlash('施工进度',steps),'Saved: Construction progress. See the next item in the roadmap: Apply for Permit.');
  const before=JSON.stringify(steps);setLanguage('zh-CN');assert.match(eventText(ev),/持续事项仍需跟进/);assert.equal(JSON.stringify(steps),before);
});
