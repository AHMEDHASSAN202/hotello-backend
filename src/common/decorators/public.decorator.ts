import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as open — the global JWT guard skips it. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
