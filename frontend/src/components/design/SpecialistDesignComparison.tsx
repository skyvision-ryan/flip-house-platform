import { useState } from 'react';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '../ui/Header';
import ProcurementDesign from './ProcurementDesign';
import ZoeyDesign from './ZoeyDesign';
import SabrinaDesign from './SabrinaDesign';
import { parseDesignPreferences, type SpecialistPersona, type SpecialistPreview } from '../../lib/roleDesigns';

export default function SpecialistDesignComparison({ persona, preview, storageKey }: {
  persona: SpecialistPersona; preview: SpecialistPreview; storageKey: string;
}) {
  const [saved, setSaved] = useState(() => {
    try { return parseDesignPreferences(localStorage.getItem(storageKey))[persona]; } catch { return undefined; }
  });
  const [choice, setChoice] = useState(saved?.choice ?? preview.default_design);
  const [note, setNote] = useState(saved?.note ?? '');
  const [message, setMessage] = useState('');
  const current = preview.designs.find(d => d.id === choice)!;
  const Workspace = persona === 'procurement' ? ProcurementDesign : persona === 'zoey' ? ZoeyDesign : SabrinaDesign;
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ [persona]: { choice, note } }));
      setSaved({ choice, note }); setMessage('选择与意见已保存在当前账号的此浏览器中。');
    } catch { setMessage('浏览器未允许保存；可复制选择与意见发给我。'); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${preview.role_title}：倾向方案 ${choice}「${current.title}」，参考 ${current.source}。${note ? `想调整：${note}` : ''}`);
      setMessage('已复制，可直接粘贴给我。');
    } catch { setMessage('复制未成功，请把方案字母和想改的地方直接发给我。'); }
  };
  return <ContentLayout maxContentWidth={1680} header={<Header variant="h1" description="比较职责所需的信息组织方式，选择更顺手的一种。">{preview.role_title} · 设计比较</Header>}>
    <div className="ui-rd-role-brief"><h2>{preview.role_title}需要怎样的工作界面？</h2><p>{preview.role_description}</p></div>
    <div className="ui-rd-directions" role="group" aria-label="选择参考设计">{preview.designs.map(d => <button key={d.id} aria-pressed={d.id === choice} onClick={() => { setChoice(d.id); setMessage(''); }}><small>方案 {d.id} · {d.source}{d.id === preview.default_design ? ' · 建议先看' : ''}</small><strong>{d.title}</strong><span>{d.question}</span></button>)}</div>
    <div className="ui-rd-reference"><div><strong>借鉴 {current.source} 的什么？</strong><p>{current.borrowed}</p></div><div><strong>怎样适配这份工作？</strong><p>{current.adapted}</p></div><div><strong>适合与取舍</strong><p>{current.gain} {current.cost}</p></div><a href={current.url} target="_blank" rel="noreferrer">官方参考：{current.sourceLabel} ↗</a></div>
    <div className="ui-rd-preview-caption"><strong>{current.title} · 可点击工作界面</strong><span>三个方案共用同一批合成记录；可筛选、点开资料和编辑预览，沿用已选定的轻量 B 视觉。</span></div>
    <Workspace preview={preview} design={current} />
    <section className="ui-rd-preference" aria-label="记录设计选择"><div><h2>哪种组织方式更顺手？</h2><p>偏好按登录账号分别保存在此浏览器；复制后发给 Ryan。工作界面中的示例修改仅保留在本次预览，刷新后恢复。</p>{saved && <p>已记录：方案 {saved.choice} · {preview.designs.find(d => d.id === saved.choice)?.title}</p>}</div><label>哪些信息或操作应该更靠前？<textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="写下最常找的资料、容易漏的事项或希望调整的地方" /></label><div className="ui-actions ui-actions-start"><Button variant="primary" onClick={save}>我倾向 {choice} · {current.title}</Button><Button onClick={copy}>复制选择与意见</Button></div>{message && <p role="status">{message}</p>}</section>
  </ContentLayout>;
}
