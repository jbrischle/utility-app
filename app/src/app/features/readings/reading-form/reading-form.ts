import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { form, FormField, min, required, submit } from '@angular/forms/signals';
import { LocalStore } from '../../../data/local-store';
import { resizeImage } from '../../../shared/image.util';
import { UTILITY_LABELS } from '../../../models/utility-type';
import { Reading } from '../../../models/reading.model';

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
  produced: number | null;
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
  readonly labels = UTILITY_LABELS;
  readonly notFound = signal(false);
  readonly showWarning = signal(false);
  readonly warningMessages = signal<string[]>([]);
  readonly submitAttempted = signal(false);
  readonly saving = signal(false);
  readonly previewUrl = signal<string | null>(null);
  readonly hasPhoto = computed(() => this.previewUrl() !== null);
  readonly model = signal<ReadingFormModel>({
    value: null,
    produced: 0,
    readAt: toDateInput(new Date().toISOString()),
    note: '',
  });
  readonly readingForm = form(this.model, (p) => {
    required(p.value, { message: 'Enter the current meter reading.' });
    min(p.value, 0, { message: 'The reading must be zero or greater.' });
    required(p.readAt, { message: 'Pick a date.' });
  });
  readonly isElectricity = computed(() => this.meter()?.type === 'electricity');
  /** Production is validated manually since it only applies to electricity meters. */
  readonly producedInvalid = computed(
    () => this.isElectricity() && (this.model().produced === null || this.model().produced! < 0),
  );
  readonly isEdit = !!this.readingId;
  private readonly store = inject(LocalStore);
  readonly meter = computed(() => this.store.meterById(this.meterId));
  private readonly route = inject(ActivatedRoute);
  readonly meterId = this.route.snapshot.paramMap.get('meterId')!;
  readonly readingId = this.route.snapshot.paramMap.get('id');
  private readonly router = inject(Router);
  // Photo state
  private newPhoto: Blob | null = null;
  private existingPhotoId: string | null = null;
  private removedExisting = false;
  private patched = false;

  private readonly valueInput = viewChild<ElementRef<HTMLInputElement>>('valueInput');

  constructor() {
    if (!this.isEdit) {
      afterNextRender(() => this.valueInput()?.nativeElement.focus());
    }
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

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submitAttempted.set(true);
    submit(this.readingForm, async () => {
      if (this.producedInvalid()) return;
      const warnings = this.lowReadingWarnings();
      if (warnings.length) {
        this.warningMessages.set(warnings);
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

  private async loadReading(): Promise<void> {
    const reading = await this.store.getReading(this.readingId!);
    if (!reading || reading.deletedAt) {
      this.notFound.set(true);
      return;
    }
    this.model.set({
      value: reading.value,
      produced: reading.produced,
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

  private revokePreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
  }

  /** The most recent reading strictly before the entered date (excluding this one). */
  private previousReading(): Reading | null {
    const readAtValue = this.model().readAt;
    if (!readAtValue) return null;
    const targetIso = fromDateInput(readAtValue);
    const candidates = this.store
      .readingsForMeter(this.meterId)
      .filter((r) => r.id !== this.readingId && r.readAt < targetIso);
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  private lowReadingWarnings(): string[] {
    const messages: string[] = [];
    const unit = this.meter()?.unit ?? '';
    const prev = this.previousReading();
    if (!prev) return messages;
    const m = this.model();
    if (m.value !== null && m.value < prev.value) {
      const label = this.isElectricity() ? 'Consumed' : 'Reading';
      messages.push(
        `${label} (${m.value} ${unit}) is lower than the previous reading (${prev.value} ${unit}).`,
      );
    }
    if (
      this.isElectricity() &&
      m.produced !== null &&
      prev.produced !== null &&
      m.produced < prev.produced
    ) {
      messages.push(
        `Produced (${m.produced} ${unit}) is lower than the previous reading (${prev.produced} ${unit}).`,
      );
    }
    return messages;
  }

  private async persist(): Promise<void> {
    this.saving.set(true);
    const raw = this.model();
    const input = {
      meterId: this.meterId,
      value: raw.value!,
      produced: this.isElectricity() ? raw.produced : null,
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
