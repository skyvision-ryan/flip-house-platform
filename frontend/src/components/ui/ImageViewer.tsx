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
  render() { return this.state.failed ? <Alert type="error">图片工具未能载入。可在新窗口查看原图，或关闭后刷新页面重试。</Alert> : this.props.children; }
}

/** Uses existing authenticated image URLs; no image content leaves this service. */
export default function ImageViewer({ images, selectedId, onClose }: { images: ViewerImage[]; selectedId: number; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex(image => image.id === selectedId)));
  const image = images[Math.min(index, images.length - 1)];
  return <Modal visible size="max" header={image?.label ?? '图片查看'} onDismiss={onClose}
    footer={<SpaceBetween direction="horizontal" size="s">
      <Button disabled={index === 0} onClick={() => setIndex(i => i - 1)}>上一张</Button>
      <span role="status">{image ? index + 1 : 0} / {images.length}</span>
      <Button disabled={index >= images.length - 1} onClick={() => setIndex(i => i + 1)}>下一张</Button>
      {image && <Button href={image.src} target="_blank" rel="noreferrer" iconName="external">查看原图</Button>}
      <Button onClick={onClose}>关闭图片</Button>
    </SpaceBetween>}>
    {image ? <ViewerBoundary><Suspense fallback={<div role="status"><Spinner /> 正在加载图片工具…</div>}>
      <ImageCanvas key={image.src} src={image.src} label={image.label} />
    </Suspense></ViewerBoundary> : <Alert>图片已不在当前列表中，请关闭后重新读取。</Alert>}
  </Modal>;
}
