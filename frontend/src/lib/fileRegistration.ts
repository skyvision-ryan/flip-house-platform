export interface FileRegistrationDraft {
  doc_type: string;
  doc_date: string;
  counterparty: string;
  amount: string;
  uploaded_by: string;
  expires_at: string;
}

/** Omit protected fields entirely: sending their unchanged values is still a forbidden edit. */
export function fileRegistrationPatch(draft: FileRegistrationDraft, canManageMetadata: boolean, canReadMoney: boolean) {
  return {
    doc_date: draft.doc_date || null,
    counterparty: draft.counterparty || null,
    expires_at: draft.expires_at || null,
    ...(canManageMetadata ? { doc_type: draft.doc_type, uploaded_by: draft.uploaded_by || null } : {}),
    ...(canReadMoney ? { amount: draft.amount === '' ? null : Number(draft.amount) } : {}),
  };
}
