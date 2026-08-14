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
import { Reading, ReadingInput } from '../../../models/reading.model';
import { toSignal } from '@angular/core/rxjs-interop';

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
  readonly model = signal<ReadingInput>({
    consumed: 0,
    produced: 0,
    readAt: this.toDateInput(new Date().toISOString()),
    note: '',
  });
  readonly readingForm = form(this.model, (p) => {
    required(p.consumed, { message: 'Enter the current meter reading.' });
    min(p.consumed, 0, { message: 'The reading must be zero or greater.' });
    required(p.readAt, { message: 'Pick a date.' });
  });
  /** Production is validated manually since it only applies to electricity meters. */
  readonly producedInvalid = computed(
    () => this.isElectricity() && (this.model().produced === null || this.model().produced! < 0),
  );
  readonly isEdit = computed(() => !!this.readingId());
  private readonly store = inject(LocalStore);
  readonly meter = computed(() => {
    const meterId = this.meterId();
    if (meterId) {
      return this.store.getMeterById(meterId);
    }
    return undefined;
  });
  readonly isElectricity = computed(() => {
    const meter = this.meter();
    if (meter) {
      return this.meter()?.type === 'electricity';
    }
    return false;
  });
  private readonly route = inject(ActivatedRoute);
  private readonly routerParamMap = toSignal(this.route.paramMap);
  readonly readingId = computed(() => this.routerParamMap()?.get('id'));
  readonly meterId = computed(() => this.routerParamMap()?.get('meterId'));
  private readonly router = inject(Router);
  private newPhoto: Blob | null = null;
  private existingPhotoId: string | null = null;
  private removedExisting = false;
  private patched = false;

  private readonly valueInput = viewChild<ElementRef<HTMLInputElement>>('valueInput');

  constructor() {
    if (!this.isEdit()) {
      afterNextRender(() => this.valueInput()?.nativeElement.focus());
    }
    effect(() => {
      const meterId = this.meterId();
      const readingId = this.readingId();
      if (!this.store.ready() || !meterId) {
        return;
      }
      if (!this.store.getMeterById(meterId)) {
        this.notFound.set(true);
        return;
      }
      if (this.isEdit() && !this.patched && readingId) {
        this.patched = true;
        void this.loadReading(readingId);
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

  private async loadReading(readingId: string): Promise<void> {
    const reading = await this.store.getReading(readingId);
    if (!reading || reading.deletedAt) {
      this.notFound.set(true);
      return;
    }
    this.model.set({
      consumed: reading.consumed,
      produced: reading.produced,
      readAt: this.toDateInput(reading.readAt),
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
    const readingId = this.readingId();
    const meterId = this.meterId();
    if (!readingId || !meterId) {
      return null;
    }

    const readAtValue = this.model().readAt;
    if (!readAtValue) return null;
    const targetIso = this.fromDateInput(readAtValue);
    const candidates = this.store
      .readingsForMeter(meterId)
      .filter((r) => r.id !== readingId && r.readAt < targetIso);
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  private lowReadingWarnings(): string[] {
    const messages: string[] = [];
    const unit = this.meter()?.unit ?? '';
    const prev = this.previousReading();
    if (!prev) return messages;
    const m = this.model();
    if (m.consumed !== null && m.consumed < prev.consumed) {
      const label = this.isElectricity() ? 'Consumed' : 'Reading';
      messages.push(
        `${label} (${m.consumed} ${unit}) is lower than the previous reading (${prev.consumed} ${unit}).`,
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
    const meterId = this.meterId();
    if (!meterId) {
      return;
    }

    this.saving.set(true);
    const raw = this.model();
    const input = {
      meterId: meterId,
      consumed: raw.consumed,
      produced: this.isElectricity() ? raw.produced : null,
      readAt: this.fromDateInput(raw.readAt),
      note: raw.note,
    };
    try {
      const readingId = this.readingId();
      if (readingId && this.isEdit()) {
        let photoChange: { photo: Blob | null } | undefined;
        if (this.newPhoto) {
          photoChange = { photo: this.newPhoto };
        } else if (this.removedExisting && this.existingPhotoId) {
          photoChange = { photo: null };
        }
        await this.store.updateReading(readingId, input, photoChange);
      } else {
        await this.store.addReading(input, this.newPhoto ?? undefined);
      }
      this.revokePreview();
      await this.router.navigate(['/meters', this.meterId()]);
    } finally {
      this.saving.set(false);
    }
  }

  private pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  private toDateInput(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
  }

  private fromDateInput(value: string): string {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toISOString();
  }
}
