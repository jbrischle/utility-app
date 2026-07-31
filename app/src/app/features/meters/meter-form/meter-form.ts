import { Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { LocalStore } from '../../../data/local-store';
import {
  UTILITY_TYPES,
  UTILITY_LABELS,
  UTILITY_UNITS,
  UtilityType,
} from '../../../models/utility-type';

@Component({
  selector: 'app-meter-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './meter-form.html',
  styleUrl: './meter-form.css',
})
export class MeterForm {
  private readonly fb = inject(FormBuilder);
  private readonly store = inject(LocalStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly types = UTILITY_TYPES;
  readonly labels = UTILITY_LABELS;
  readonly units = UTILITY_UNITS;

  readonly id = this.route.snapshot.paramMap.get('id');
  readonly isEdit = !!this.id;
  readonly notFound = signal(false);
  private patched = false;

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    type: ['electricity' as UtilityType, Validators.required],
    location: [''],
    serialNumber: [''],
    notes: [''],
  });

  constructor() {
    if (this.isEdit) {
      effect(() => {
        if (this.patched || !this.store.ready()) return;
        const meter = this.store.meterById(this.id!);
        if (!meter) {
          this.notFound.set(true);
          return;
        }
        this.form.patchValue({
          name: meter.name,
          type: meter.type,
          location: meter.location,
          serialNumber: meter.serialNumber,
          notes: meter.notes,
        });
        this.patched = true;
      });
    }
  }

  unitPreview(): string {
    return this.units[this.form.controls.type.value];
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    if (this.isEdit) {
      await this.store.updateMeter(this.id!, value);
      await this.router.navigate(['/meters', this.id]);
    } else {
      const meter = await this.store.addMeter(value);
      await this.router.navigate(['/meters', meter.id]);
    }
  }
}
