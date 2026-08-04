export interface Reading {
  id: string;
  meterId: string;
  /** Cumulative consumed total (grid draw for electricity, volume for water). */
  consumed: number;
  /** Cumulative produced/fed-in total. Only used by electricity meters; null otherwise. */
  produced: number | null;
  readAt: string;
  note: string;
  photoId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ReadingInput = Pick<Reading, 'consumed' | 'produced' | 'readAt' | 'note'>;
export type ReadingStoreInput = Pick<
  Reading,
  'meterId' | 'consumed' | 'produced' | 'readAt' | 'note'
>;

export interface ReadingWithUsage {
  reading: Reading;
  /** Consumption since the previous reading. */
  usage: number | null;
  /** Production since the previous reading (electricity meters only). */
  producedUsage: number | null;
  perDayAverage: number | null;
}
