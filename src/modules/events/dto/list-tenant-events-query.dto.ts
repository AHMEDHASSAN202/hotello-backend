import { IsIn } from 'class-validator';

export const EVENT_LIST_TABS = ['upcoming', 'past', 'cancelled'] as const;
export type EventListTab = (typeof EVENT_LIST_TABS)[number];

/** Story 21.2 AC4 — the three management tabs. */
export class ListTenantEventsQueryDto {
  @IsIn(EVENT_LIST_TABS)
  tab: EventListTab;
}
