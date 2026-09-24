import { type ReactNode } from 'react';
import BaseContainer, { type ContainerProps } from '@cloudscape-design/components/container';
import BaseTable, { type TableProps } from '@cloudscape-design/components/table';
import BaseExpandable, { type ExpandableSectionProps } from '@cloudscape-design/components/expandable-section';
import ReviewTag from '../ReviewTag';
import { type CardKey, CARD_REGISTRY } from '../../lib/cardRegistry';
import { useHelpOn } from '../HelpText';

type CardProps = { cardId: CardKey; cardContext?: string };

export function CardFrame({ cardId, cardContext, children }: CardProps & { children: ReactNode }) {
  return <div className="ui-card" data-card-id={CARD_REGISTRY[cardId].id} data-card-key={cardId} data-card-context={cardContext}>
    <ReviewTag cardId={cardId} context={cardContext} />
    {children}
  </div>;
}

export default function Container({ cardId, cardContext, ...props }: ContainerProps & CardProps) {
  return <CardFrame cardId={cardId} cardContext={cardContext}>
    <BaseContainer
      style={{
        root: {
          borderColor: 'var(--ui-border)', borderWidth: '1px', borderRadius: '8px',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.025)',
        },
        header: { paddingInline: 'clamp(16px, 2vw, 24px)', paddingBlock: '20px 16px' },
        content: props.disableContentPaddings
          ? { paddingInline: '0', paddingBlock: '0' }
          : { paddingInline: 'clamp(16px, 2vw, 24px)', paddingBlock: props.header ? '0 24px' : '24px' },
      }}
      {...props}
    />
  </CardFrame>;
}

export function Table<T>({ cardId, cardContext, ...props }: TableProps<T> & Partial<CardProps>) {
  const table = <BaseTable wrapLines {...props} />;
  return cardId ? <CardFrame cardId={cardId} cardContext={cardContext}>{table}</CardFrame> : table;
}

export function ExpandableSection({ cardId, cardContext, headerDescription, ...props }: ExpandableSectionProps & Partial<CardProps>) {
  const help = useHelpOn();
  const section = <BaseExpandable {...props} headerDescription={help ? headerDescription : undefined} />;
  return cardId ? <CardFrame cardId={cardId} cardContext={cardContext}>{section}</CardFrame> : section;
}
