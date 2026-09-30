import RadioGroup from '@cloudscape-design/components/radio-group';
import { m as uiText, setLanguage } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import Button from '@cloudscape-design/components/button';
import Icon from '@cloudscape-design/components/icon';
import Modal from '@cloudscape-design/components/modal';
import Toggle from '@cloudscape-design/components/toggle';

export default function DisplaySettings({ visible, helpOn, reviewOn, onHelp, onReview, onDismiss }: {
  visible: boolean; helpOn: boolean; reviewOn: boolean; onHelp: (on: boolean) => void; onReview: (on: boolean) => void; onDismiss: () => void;
}) {
  const language = useLanguage();
  return <Modal visible={visible} onDismiss={onDismiss} header={uiText('settings.title')} size="medium"
    footer={<div className="ui-actions"><Button variant="primary" onClick={onDismiss}>{uiText('common.done')}</Button></div>}>
    <div className="ui-language-setting"><h3 id="language-setting-label">{uiText('settings.languageControl')}</h3><RadioGroup ariaLabel={uiText('settings.languageControl')} direction="horizontal" value={language} items={[{ value: 'zh-CN', label: '中文' }, { value: 'en', label: 'English' }]} onChange={({ detail }) => setLanguage(detail.value === 'en' ? 'en' : 'zh-CN')} /><p>{uiText('settings.languageHint')}</p></div>
    <p className="ui-muted">{uiText("displaySettings.show.the.help.and.feedback.numbers.you.need.settings")}</p>
    <div className="ui-setting-row">
      <div className="ui-setting-icon"><Icon name="status-info" /></div>
      <div><h3>{uiText("displaySettings.help.text")}</h3><p>{uiText("displaySettings.show.instructions.for.cards.and.forms.essential.status.risk")}</p></div>
      <Toggle checked={helpOn} onChange={({ detail }) => onHelp(detail.checked)}>{uiText("displaySettings.help.text")}</Toggle>
    </div>
    <div className="ui-setting-row">
      <div className="ui-setting-icon"><Icon name="contact" /></div>
      <div><h3>{uiText("displaySettings.card.numbers")}</h3><p>{uiText("displaySettings.show.fixed.numbers.from.1.99.click.a.number")}</p></div>
      <Toggle checked={reviewOn} onChange={({ detail }) => onReview(detail.checked)}>{uiText("displaySettings.card.numbers")}</Toggle>
    </div>
    <div className="ui-setting-example"><strong>{uiText("displaySettings.feedback.example")}</strong><span>{uiText("displaySettings.project.overview.card.08.the.due.date.is.cut")}</span></div>
  </Modal>;
}
