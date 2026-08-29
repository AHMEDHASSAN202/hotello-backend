/**
 * Storage-key prefixes owned by the rendition pipeline. `FilesController`
 * serves anything under these prefixes with an immutable, year-long cache —
 * safe because a new upload always gets a fresh uuid key, never overwriting
 * the old one (Story 21.1 AC1).
 */
export const IMMUTABLE_RENDITION_PREFIXES = ['fnb/', 'hotel-info/', 'branding/', 'events/'];
