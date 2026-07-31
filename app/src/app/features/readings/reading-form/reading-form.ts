import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  form,
  FormField,
  required,
  min,
  submit,
} from '@angular/forms/signals';
import { LocalStore } from '../../../data/local-store';
import { resizeImage } from '../../../shared/image.util';
import { UTILITY_LABELS } from '../../../models/utility-type';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toISOString();
}

interface ReadingFormModel {
  value: number | null;
  readAt: string;
  note: string;
}

@Component({
  selector: 'app-reading-form',
  imports: [FormField, RouterLink],
  templateUrl: './reading-form.html',
  styleUrl: './reading-form.css',
})
export class ReadingForm {
  private readonly store = inject(LocalStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly labels = UTILITY_LABELS;
  readonly meterId = this.route.snapshot.paramMap.get('meterId')!;
  readonly readingId = this.route.snapshot.paramMap.get('id');
  readonly isEdit = !!this.readingId;

  readonly meter = computed(() => this.store.meterById(this.meterId));
  readonly notFound = signal(false);
  readonly showWarning = signal(false);
  readonly saving = signal(false);

  // Photo state
  private newPhoto: Blob | null = null;
  private existingPhotoId: string | null = null;
  private removedExisting = false;
  readonly previewUrl = signal<string | null>(null);
  readonly hasPhoto = computed(() => this.previewUrl() !== null);

  private patched = false;

  readonly model = signal<ReadingFormModel>({
    value: null,
    readAt: toDateInput(new Date().toISOString()),
    note: '',
  });

  readonly readingForm = form(this.model, (p) => {
    required(p.value, { message: 'Enter the current meter reading.' });
    min(p.value, 0, { message: 'The reading must be zero or greater.' });
    required(p.readAt, { message: 'Pick a date and time.' });
  });

  constructor() {
    effect(() => {
      if (!this.store.ready()) return;
      if (!this.store.meterById(this.meterId)) {
        this.notFound.set(true);
        return;
      }
      if (this.isEdit && !this.patched) {
        this.patched = true;
        void this.loadReading();
      }
    });
  }

  private async loadReading(): Promise<void> {
    const reading = await this.store.getReading(this.readingId!);
    if (!reading || reading.deletedAt) {
      this.notFound.set(true);
      return;
    }
    this.model.set({
      value: reading.value,
      readAt: toDateInput(reading.readAt),
      note: reading.note,
    });
    this.existingPhotoId = reading.photoId;
    if (reading.photoId) {
      const photo = await this.store.getPhoto(reading.photoId);
      if (photo) {
        this.previewUrl.set(URL.createObjectURL(photo.data));
      }
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const resized = await resizeImage(file);
    this.newPhoto = resized;
    this.removedExisting = false;
    this.revokePreview();
    this.previewUrl.set(URL.createObjectURL(resized));
  }

  removePhoto(): void {
    this.newPhoto = null;
    this.removedExisting = true;
    this.revokePreview();
    this.previewUrl.set(null);
  }

  private revokePreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
  }

  /** The most recent reading value strictly before the entered time (excluding this one). */
  previousValue(): number | null {
    const readAtValue = this.model().readAt;
    if (!readAtValue) return null;
    const targetIso = fromDateInput(readAtValue);
    const candidates = this.store
      .readingsForMeter(this.meterId)
      .filter((r) => r.id !== this.readingId && r.readAt < targetIso);
    return candidates.length ? candidates[candidates.length - 1].value : null;
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    submit(this.readingForm, async () => {
      const prev = this.previousValue();
      const value = this.model().value!;
      if (prev !== null && value < prev) {
        this.showWarning.set(true);
        return;
      }
      await this.persist();
    });
  }

  confirmSaveAnyway(): void {
    this.showWarning.set(false);
    void this.persist();
  }

  cancelWarning(): void {
    this.showWarning.set(false);
  }

  private async persist(): Promise<void> {
    this.saving.set(true);
    const raw = this.model();
    const input = {
      meterId: this.meterId,
      value: raw.value!,
      readAt: fromDateInput(raw.readAt),
      note: raw.note,
    };
    try {
      if (this.isEdit) {
        let photoChange: { photo: Blob | null } | undefined;
        if (this.newPhoto) {
          photoChange = { photo: this.newPhoto };
        } else if (this.removedExisting && this.existingPhotoId) {
          photoChange = { photo: null };
        }
        await this.store.updateReading(this.readingId!, input, photoChange);
      } else {
        await this.store.addReading(input, this.newPhoto ?? undefined);
      }
      this.revokePreview();
      await this.router.navigate(['/meters', this.meterId]);
    } finally {
      this.saving.set(false);
    }
  }
}
