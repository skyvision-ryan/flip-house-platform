import Button from '@cloudscape-design/components/button';
import Icon from '@cloudscape-design/components/icon';
import Modal from '@cloudscape-design/components/modal';
import Toggle from '@cloudscape-design/components/toggle';

export default function DisplaySettings({ visible, helpOn, reviewOn, onHelp, onReview, onDismiss }: {
  visible: boolean; helpOn: boolean; reviewOn: boolean; onHelp: (on: boolean) => void; onReview: (on: boolean) => void; onDismiss: () => void;
}) {
  return <Modal visible={visible} onDismiss={onDismiss} header="显示设置" size="medium"
    footer={<div className="ui-actions"><Button variant="primary" onClick={onDismiss}>完成</Button></div>}>
    <p className="ui-muted">按需要展开说明和反馈编号。设置会保留在这台设备。</p>
    <div className="ui-setting-row">
      <div className="ui-setting-icon"><Icon name="status-info" /></div>
      <div><h3>辅助说明</h3><p>显示卡片和表单的使用说明。关闭后，重要状态、风险和必填提示仍保留。</p></div>
      <Toggle checked={helpOn} onChange={({ detail }) => onHelp(detail.checked)}>辅助说明</Toggle>
    </div>
    <div className="ui-setting-row">
      <div className="ui-setting-icon"><Icon name="contact" /></div>
      <div><h3>卡片编号</h3><p>显示固定的 1–99 编号。点击编号可复制反馈位置，再附上问题截图。</p></div>
      <Toggle checked={reviewOn} onChange={({ detail }) => onReview(detail.checked)}>卡片编号</Toggle>
    </div>
    <div className="ui-setting-example"><strong>反馈示例</strong><span>“项目总览 · 卡片 #08：截止日期显示不完整”</span></div>
  </Modal>;
}
