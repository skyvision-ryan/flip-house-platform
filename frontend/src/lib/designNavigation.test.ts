import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canViewGeneralDesign, designLocation, designSection, hasDesignDirections, legacyDesignLocation } from './designNavigation.ts';

const account = (role_code: string, is_admin = false, active = true) => ({ role_code, is_admin, active });

test('both legacy design URLs retain their destination under one entrance', () => {
  assert.equal(legacyDesignLocation('/design-choices'), '/design-directions?view=general');
  assert.equal(legacyDesignLocation('/design-collaboration', '?workspace=zoey', '#notes'), '/design-directions?workspace=zoey&view=roles#notes');
  assert.equal(legacyDesignLocation('/design-collaboration', '?view=general&workspace=david'), '/design-directions?view=roles&workspace=david');
});

test('switching categories keeps the selected role workspace and defaults safely', () => {
  assert.equal(designLocation('general', '?workspace=kody&view=roles'), '/design-directions?workspace=kody&view=general');
  assert.equal(designSection('?view=general'), 'general');
  assert.equal(designSection('?workspace=kody'), 'roles');
  assert.equal(designSection('?view=unknown'), 'roles');
});

test('one design navigation link serves eligible signed-in roles only', () => {
  for (const role of ['D', 'J', '项目助理', '采购', 'Permit/设计', '财务']) assert.equal(hasDesignDirections(account(role)), true);
  assert.equal(hasDesignDirections(account('负责人', true)), true);
  for (const role of ['负责人', 'K', '老板', 'T']) assert.equal(hasDesignDirections(account(role)), false);
  assert.equal(hasDesignDirections(null), false);
  assert.equal(hasDesignDirections(account('D', false, false)), false);
});

test('generic references stay with management; display labels cannot impersonate admin', () => {
  for (const role of ['D', 'J']) assert.equal(canViewGeneralDesign(account(role)), true);
  assert.equal(canViewGeneralDesign(account('采购', true)), true);
  for (const role of ['项目助理', '采购', 'Permit/设计', '财务', 'T', '老板']) assert.equal(canViewGeneralDesign(account(role)), false);
  assert.equal(canViewGeneralDesign(null), false);
  assert.equal(canViewGeneralDesign(account('J', true, false)), false);
});
