import { deleteQaHotels } from './db';

/** Clean the QA data the suites created — the dev DB must stay pristine. */
export default async function globalTeardown() {
  deleteQaHotels();
}
