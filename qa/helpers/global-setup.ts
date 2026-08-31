import { deleteQaHotels } from './db';

/** Wipe leftovers from previous QA runs (crashed runs included). */
export default async function globalSetup() {
  deleteQaHotels();
}
