import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
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
  useLanguage();
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
      setSaved({ choice, note }); setMessage(uiText("leadershipDesignComparison.your.selection.and.feedback.are.saved.in.this.browser"));
    } catch { setMessage(uiText("leadershipDesignComparison.browser.storage.is.unavailable.copy.your.selection.and.feedback")); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uiText("sentences.prefers.option.referencing", { value1: (preview.role_title), value2: (choice), value3: (current.title), value4: (current.source), value5: (note ? uiText("sentences.requested.changes", { value1: (note) }) : '') }));
      setMessage(uiText("leadershipDesignComparison.copied.you.can.paste.it.now"));
    } catch { setMessage(uiText("leadershipDesignComparison.copy.failed.send.the.option.letter.and.your.requested")); }
  };
  return <ContentLayout maxContentWidth={1680} header={<Header variant="h1" description={uiText("leadershipDesignComparison.compare.ways.to.organize.information.for.your.role.then")}>{systemText(preview.role_title)} {uiText("leadershipDesignComparison.design.comparison")}</Header>}>
    <div className="ui-rd-role-brief"><h2>{systemText(preview.role_title)}{uiText("leadershipDesignComparison.what.workspace.works.best.for.you")}</h2><p>{systemText(preview.role_description)}</p></div>
    <div className="ui-rd-directions" role="group" aria-label={uiText("leadershipDesignComparison.select.a.reference.design")}>{preview.designs.map(d => <button key={d.id} aria-pressed={d.id === choice} onClick={() => { setChoice(d.id); setMessage(''); }}><small>{uiText("leadershipDesignComparison.option")} {d.id} · {systemText(d.source)}{d.id === preview.default_design ? uiText("leadershipDesignComparison.suggested.starting.point") : ''}</small><strong>{systemText(d.title)}</strong><span>{systemText(d.question)}</span></button>)}</div>
    <div className="ui-rd-reference"><div><strong>{uiText("leadershipDesignComparison.reference")} {systemText(current.source)} {uiText("leadershipDesignComparison.features.to.adopt")}</strong><p>{systemText(current.borrowed)}</p></div><div><strong>{uiText("leadershipDesignComparison.how.does.it.support.this.role")}</strong><p>{systemText(current.adapted)}</p></div><div><strong>{uiText("leadershipDesignComparison.benefits.and.tradeoffs")}</strong><p>{systemText(current.gain)} {systemText(current.cost)}</p></div><a href={current.url} target="_blank" rel="noreferrer">{uiText("leadershipDesignComparison.official.reference")}{current.sourceLabel} ↗</a></div>
    <div className="ui-rd-preview-caption"><strong>{systemText(current.title)} {uiText("leadershipDesignComparison.interactive.workspace")}</strong><span>{uiText("specialistDesignComparison.all.three.options.share.the.same.synthetic.records.filter")}</span></div>
    <Workspace preview={preview} design={current} />
    <section className="ui-rd-preference" aria-label={uiText("leadershipDesignComparison.record.design.preference")}><div><h2>{uiText("leadershipDesignComparison.which.organization.works.best")}</h2><p>{uiText("leadershipDesignComparison.preferences.stay.in.this.browser.per.account.copy.them")}</p>{saved && <p>{uiText("leadershipDesignComparison.recorded.option")} {saved.choice} · {systemText(preview.designs.find(d => d.id === saved.choice)?.title)}</p>}</div><label>{uiText("leadershipDesignComparison.what.information.or.actions.should.be.more.prominent")}<textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder={uiText("leadershipDesignComparison.describe.frequently.needed.records.easily.missed.tasks.or.changes")} /></label><div className="ui-actions ui-actions-start"><Button variant="primary" onClick={save}>{uiText("leadershipDesignComparison.i.prefer")} {choice} · {systemText(current.title)}</Button><Button onClick={copy}>{uiText("leadershipDesignComparison.copy.preference.and.feedback")}</Button></div>{message && <p role="status">{message}</p>}</section>
  </ContentLayout>;
}
