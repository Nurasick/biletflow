import type { AuthenticatedFetch } from './orders';

export type CaseAudience = 'attendee' | 'organizer';
export type CaseCategory = 'ticket_delivery' | 'payment' | 'refund' | 'seating' | 'event_info' | 'check_in' | 'account' | 'technical';
export type CaseStatus = 'open' | 'in_progress' | 'waiting_for_customer' | 'resolved';
export type SupportMode = 'requester' | 'staff';
export const caseCategories: {value: CaseCategory; label: string}[] = [
  {value:'ticket_delivery', label:'Ticket delivery'}, {value:'payment', label:'Payment'},
  {value:'refund', label:'Refund'}, {value:'seating', label:'Seating'},
  {value:'event_info', label:'Event information'}, {value:'check_in', label:'Check-in'},
  {value:'account', label:'Account'}, {value:'technical', label:'Technical problem'},
];
export const caseStatusLabels: Record<CaseStatus, string> = {
  open:'Open', in_progress:'In progress', waiting_for_customer:'Waiting for customer', resolved:'Resolved',
};
export const caseTransitions: Record<CaseStatus, CaseStatus[]> = {
  open:['in_progress'], in_progress:['waiting_for_customer','resolved'], waiting_for_customer:['resolved'], resolved:[],
};
export type CaseSummary = {
  case_number: string; audience: CaseAudience; category: CaseCategory; status: CaseStatus;
  created_at: string; updated_at: string; resolved_at: string | null;
  assigned_to_user_id?: number | null; contact_email?: string;
};
export type SupportMessage = {
  id: number; sender: 'requester' | 'staff' | 'system'; body: string; created_at: string;
  is_internal_note?: boolean;
};
export type SupportCase = CaseSummary & {
  context: {event_id: number | null; event_title: string | null; order_number: string | null; ticket_code: string | null};
  messages: SupportMessage[];
};
export type NewCase = {
  audience: CaseAudience; category: CaseCategory; body: string;
  event_id?: number; order_number?: string; ticket_code?: string;
};

function base(mode: SupportMode) { return mode === 'staff' ? '/staff/support/cases' : '/support/cases'; }
function messageBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 5000) throw new Error('Write a message between 1 and 5000 characters.');
  return trimmed;
}
async function request<T>(fetcher: AuthenticatedFetch, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetcher(path, init); }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Connection failed. Refresh the conversation before retrying; your last action may have reached the server.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    if (response.status === 403) throw new Error('You do not have permission to access this support case.');
    if (response.status === 404) throw new Error('Support case or its context was not found, or you do not have access.');
    throw new Error(typeof detail === 'string' ? detail : 'The support request could not be completed.');
  }
  return body as T;
}
const json = (body: unknown, method='POST'): RequestInit => ({method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
export function visibleMessages(detail: SupportCase, mode: SupportMode): SupportMessage[] {
  return detail.messages.filter(message => mode === 'staff' || !message.is_internal_note)
    .slice().sort((a,b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id-b.id);
}
export function validateNewCase(input: NewCase): NewCase {
  if (!caseCategories.some(item => item.value === input.category)) throw new Error('Choose an issue category.');
  if (input.audience !== 'attendee' && input.audience !== 'organizer') throw new Error('Invalid support audience.');
  if (input.event_id !== undefined && (!Number.isSafeInteger(input.event_id) || input.event_id <= 0)) throw new Error('Invalid event context.');
  if (input.audience === 'attendee' && !input.event_id && !input.order_number && !input.ticket_code) throw new Error('Open support from an event, order, or ticket to include its context.');
  if (input.audience === 'organizer' && (input.order_number || input.ticket_code)) throw new Error('Platform support can only include event context.');
  if ((input.order_number && input.order_number.length > 32) || (input.ticket_code && input.ticket_code.length > 32)) throw new Error('Invalid support context.');
  return {...input, body:messageBody(input.body)};
}
export const supportApi = {
  async list(fetcher: AuthenticatedFetch, mode: SupportMode, signal?: AbortSignal): Promise<CaseSummary[]> {
    if (mode === 'requester') return request<CaseSummary[]>(fetcher, base(mode), {signal});
    const all: CaseSummary[] = [];
    for (let offset=0;;offset+=100) {
      const page = await request<CaseSummary[]>(fetcher, base(mode)+'?limit=100&offset='+offset, {signal});
      all.push(...page); if (page.length < 100) return all;
    }
  },
  read: (fetcher: AuthenticatedFetch, number: string, mode: SupportMode, signal?: AbortSignal) => request<SupportCase>(fetcher, base(mode)+'/'+encodeURIComponent(number), {signal}),
  create: (fetcher: AuthenticatedFetch, input: NewCase) => request<SupportCase>(fetcher, base('requester'), json(validateNewCase(input))),
  reply(fetcher: AuthenticatedFetch, number: string, mode: SupportMode, text: string, internal=false) {
    const body = messageBody(text);
    return request<SupportCase>(fetcher, base(mode)+'/'+encodeURIComponent(number)+'/messages', json(mode === 'staff' ? {body, is_internal_note:internal} : {body}));
  },
  transition(fetcher: AuthenticatedFetch, detail: SupportCase, target: CaseStatus) {
    if (!caseTransitions[detail.status].includes(target)) throw new Error('That support status change is not allowed.');
    return request<SupportCase>(fetcher, base('staff')+'/'+encodeURIComponent(detail.case_number), json({status:target},'PATCH'));
  },
  assign(fetcher: AuthenticatedFetch, number: string, userId: number | null) {
    if (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0)) throw new Error('Enter a valid staff user ID.');
    return request<SupportCase>(fetcher, base('staff')+'/'+encodeURIComponent(number), json({assigned_to_user_id:userId},'PATCH'));
  },
  currentUser: (fetcher: AuthenticatedFetch) => request<{id:number}>(fetcher, '/users/me'),
};
