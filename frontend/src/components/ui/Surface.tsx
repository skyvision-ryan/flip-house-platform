import { type ReactNode } from 'react';
import BaseContainer, { type ContainerProps } from '@cloudscape-design/components/container';
import BaseTable, { type TableProps } from '@cloudscape-design/components/table';
import BaseExpandable, { type ExpandableSectionProps } from '@cloudscape-design/components/expandable-section';
import ReviewTag from '../ReviewTag';
import { type CardKey, CARD_REGISTRY } from '../../lib/cardRegistry';
import HelpText from '../HelpText';

type CardProps = { cardId: CardKey; cardContext?: string };

export function CardFrame({ cardId, cardContext, children }: CardProps & { children: ReactNode }) {
  return <div className="ui-card" data-card-id={CARD_REGISTRY[cardId].id} data-card-key={cardId} data-card-context={cardContext}>
    <ReviewTag cardId={cardId} context={cardContext} />
    {children}
  </div>;
}

export default function Container({ cardId, cardContext, embedded = false, ...props }: ContainerProps & CardProps & { embedded?: boolean }) {
  return <CardFrame cardId={cardId} cardContext={cardContext}>
    <BaseContainer {...props} style={embedded ? {
      root: { background: 'transparent', borderWidth: '0', borderRadius: '0', boxShadow: 'none' },
      header: { paddingInline: '0', paddingBlock: '16px' },
      content: { paddingInline: '0', paddingBlock: '16px' },
    } : props.style} />
  </CardFrame>;
}

export function Table<T>({ cardId, cardContext, ...props }: TableProps<T> & Partial<CardProps>) {
  const table = <BaseTable wrapLines {...props} />;
  return cardId ? <CardFrame cardId={cardId} cardContext={cardContext}>{table}</CardFrame> : table;
}

export function ExpandableSection({ cardId, cardContext, headerDescription, children, ...props }: ExpandableSectionProps & Partial<CardProps>) {
  const section = <BaseExpandable {...props}>
    {headerDescription && <HelpText>{headerDescription}</HelpText>}
    {children}
  </BaseExpandable>;
  return cardId ? <CardFrame cardId={cardId} cardContext={cardContext}>{section}</CardFrame> : section;
}
