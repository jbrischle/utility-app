import { Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  form,
  FormField,
  required,
  maxLength,
  submit,
} from '@angular/forms/signals';
import { LocalStore } from '../../../data/local-store';
import {
  UTILITY_TYPES,
  UTILITY_LABELS,
  UTILITY_UNITS,
  UtilityType,
} from '../../../models/utility-type';

interface MeterFormModel {
  name: string;
  type: UtilityType;
  location: string;
  serialNumber: string;
  notes: string;
}

@Component({
  selector: 'app-meter-form',
  imports: [FormField, RouterLink],
  templateUrl: './meter-form.html',
  styleUrl: './meter-form.css',
})
export class MeterForm {
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

  readonly model = signal<MeterFormModel>({
    name: '',
    type: 'electricity',
    location: '',
    serialNumber: '',
    notes: '',
  });

  readonly meterForm = form(this.model, (p) => {
    required(p.name, { message: 'A name is required.' });
    maxLength(p.name, 80, { message: 'Use at most 80 characters.' });
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
        this.model.set({
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
    return this.units[this.model().type];
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    submit(this.meterForm, async () => {
      const value = this.model();
      if (this.isEdit) {
        await this.store.updateMeter(this.id!, value);
        await this.router.navigate(['/meters', this.id]);
      } else {
        const meter = await this.store.addMeter(value);
        await this.router.navigate(['/meters', meter.id]);
      }
    });
  }
}
