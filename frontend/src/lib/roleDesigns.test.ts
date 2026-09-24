import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDesignPreferences, visibleDesignTasks, type DesignHouse, type DesignTask } from './roleDesigns.ts';

const { houses, tasks } = JSON.parse(readFileSync(new URL('../../../backend/app/role_designs.json', import.meta.url), 'utf8')) as { houses: DesignHouse[]; tasks: DesignTask[] };
test('Kody preview only includes his own service work while Jessie retains all business context', () => {
  assert(visibleDesignTasks(tasks, houses, 'kody', '').every(t => t.person === 'Kody'));
  assert(visibleDesignTasks(tasks, houses, 'jessie', '').some(t => t.category === '上市准备'));
  assert.equal(visibleDesignTasks(tasks, houses, 'kody', '', '采购').length, 0);
  assert(visibleDesignTasks(tasks, houses, 'jessie', '', '采购').length > 0);
});
test('project context and search jointly constrain the preview', () => {
  assert.deepEqual(visibleDesignTasks(tasks, houses, 'jessie', '  CEDAR  ').map(t => t.house), ['cedar']);
  assert.equal(visibleDesignTasks(tasks, houses, 'jessie', '厨房', '全部', 'cedar').length, 0);
  assert.equal(visibleDesignTasks(tasks, houses, 'jessie', '厨房', '待审核', 'oak').length, 1);
  assert.equal(visibleDesignTasks(tasks, houses, 'kody', '不存在').length, 0);
});
test('overview task deadlines agree with the same house task details', () => {
  for (const house of houses) if (house.date !== '未设定') assert(tasks.some(task => task.house === house.id && task.due === house.date), `${house.name}: overview deadline has no matching task`);
});
test('corrupt or stale browser preferences cannot crash the design page', () => {
  for (const raw of ['null', '123', 'bad json', '{"jessie":{"choice":"D","note":"old"}}', '{"kody":{"choice":"A","note":null}}']) assert.deepEqual(parseDesignPreferences(raw), {});
  assert.deepEqual(parseDesignPreferences('{"jessie":{"choice":"B","note":"看全盘"},"kody":{"choice":"C","note":"按公司办理"}}'), { jessie: { choice: 'B', note: '看全盘' }, kody: { choice: 'C', note: '按公司办理' } });
});

test('specialist preferences retain separate choices and discard invalid saved entries', () => {
  const parsed = parseDesignPreferences(JSON.stringify({
    procurement: { choice: 'C', note: '选型资料' },
    zoey: { choice: 'B', note: '补件优先' },
    sabrina: { choice: 'A', note: 'x'.repeat(1100) },
    unassigned: { choice: 'A', note: 'unbuilt' },
  }));
  assert.equal(parsed.procurement?.choice, 'C');
  assert.equal(parsed.zoey?.choice, 'B');
  assert.equal(parsed.sabrina?.note.length, 1000);
  assert.deepEqual(Object.keys(parsed).sort(), ['procurement', 'sabrina', 'zoey']);
});
