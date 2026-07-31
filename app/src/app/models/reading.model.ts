export interface Reading {
  id: string;
  meterId: string;
  value: number;
  readAt: string;
  note: string;
  photoId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ReadingInput = Pick<
  Reading,
  'meterId' | 'value' | 'readAt' | 'note'
>;

export interface ReadingWithUsage {
  reading: Reading;
  usage: number | null;
  perDayAverage: number | null;
}
