import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDate, creationInstant, isNewToday, compareNewToday, prioritizeToday, projectListReturnPath } from './projectDates.ts';

test('LA midnight and fall-back hour use explicit instants; unknown legacy clocks stay unknown', () => {
  assert.equal(businessDate(new Date('2026-10-02T06:59:59Z')), '2026-10-01');
  assert.equal(businessDate(new Date('2026-10-02T07:00:00Z')), '2026-10-02');
  assert.equal(isNewToday('2026-10-01T23:59:59-07:00', '2026-10-02'), false);
  assert.equal(isNewToday('2026-10-02T00:00:00-07:00', '2026-10-02'), true);
  for (const offset of ['-07:00', '-08:00']) assert.equal(isNewToday(`2026-11-01T01:30:00${offset}`, '2026-11-01'),true);
  for (const value of ['',undefined,'invalid','2026-10-02T07:00:00','2026-10-02']) assert.equal(creationInstant(value),null);
});
test('default view puts new houses first among 100 old houses, stable ties, maintenance cannot make them new', () => {
  const old = Array.from({length:100}, (_,i)=>({id:i+1,created_at:'2026-01-01T00:00:00Z',updated_at:'9999-01-01'}));
  const fresh = [101,102].map(id=>({id,created_at:'2026-10-02T07:00:00Z',updated_at:'2000-01-01'}));
  const result=[...old,...fresh].sort((a,b)=>compareNewToday(a,b,'2026-10-02'));
  assert.deepEqual(result.slice(0,2).map(p=>p.id),[102,101]);
  assert.deepEqual(prioritizeToday([...old,...fresh],p=>p.id,'2026-10-02'),result);
  assert.equal(result.filter(p=>isNewToday(p.created_at,'2026-10-03')).length,0);
});
test('return locator preserves chosen query, stage, today filter and sort without accepting an external URL', () => {
  const path=projectListReturnPath('/projects?q=House&group=buying&sub=escrow&today=1&sort=name&desc=1',103);
  assert.equal(path,'/projects?q=House&group=buying&sub=escrow&today=1&sort=name&desc=1&focus=103');
  assert.equal(projectListReturnPath('https://other.example/projects?x=1',103),'/projects?focus=103');
});
