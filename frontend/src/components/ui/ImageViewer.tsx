import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { Component, lazy, Suspense, useState, type ReactNode } from 'react';

const ImageCanvas = lazy(() => import('./ImageCanvas'));
export type ViewerImage = { id: number; src: string; label: string };

class ViewerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Alert type="error">{uiText("imageViewer.the.image.viewer.could.not.load.open.the.original")}</Alert> : this.props.children; }
}

/** Uses existing authenticated image URLs; no image content leaves this service. */
export default function ImageViewer({ images, selectedId, onClose }: { images: ViewerImage[]; selectedId: number; onClose: () => void }) {
  useLanguage();
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex(image => image.id === selectedId)));
  const image = images[Math.min(index, images.length - 1)];
  return <Modal visible size="max" header={image?.label ?? uiText("imageViewer.image.viewer")} onDismiss={onClose}
    footer={<SpaceBetween direction="horizontal" size="s">
      <Button disabled={index === 0} onClick={() => setIndex(i => i - 1)}>{uiText("imageViewer.previous.image")}</Button>
      <span role="status">{image ? index + 1 : 0} / {images.length}</span>
      <Button disabled={index >= images.length - 1} onClick={() => setIndex(i => i + 1)}>{uiText("imageViewer.next.image")}</Button>
      {image && <Button href={image.src} target="_blank" rel="noreferrer" iconName="external">{uiText("imageViewer.view.original.image")}</Button>}
      <Button onClick={onClose}>{uiText("imageViewer.close.image")}</Button>
    </SpaceBetween>}>
    {image ? <ViewerBoundary><Suspense fallback={<div role="status"><Spinner /> {uiText("imageViewer.loading.image.viewer")}</div>}>
      <ImageCanvas key={image.src} src={image.src} label={systemText(image.label)} />
    </Suspense></ViewerBoundary> : <Alert>{uiText("imageViewer.this.image.is.no.longer.in.the.list.close")}</Alert>}
  </Modal>;
}
